import assert from 'node:assert/strict';
import test from 'node:test';
import { RtcHostTransport } from '../dist/index.js';
import { Network, waitFor } from '../test-support/network.mjs';

async function room(t, extra = {}, count = 3) {
  const network = new Network();
  const transports = Array.from({ length: count }, () => new RtcHostTransport(network.createPeer));
  const names = ['host', 'alice', 'bob', 'carol'];
  const options = {
    roomId: 'room', endpoint: 'https://peer.example.test',
    reconnect: { intervalMs: 10 }, hostMigration: { timeoutMs: 200 }, ...extra,
  };
  t.after(() => transports.forEach((transport) => transport.disconnect()));
  for (const [index, transport] of transports.entries()) {
    await transport.connect({ ...options, role: index ? 'client' : 'host', userId: names[index] });
  }
  await waitFor(() => transports.every((transport) => transport.getPeers().length === count - 1));
  return { network, transports, host: transports[0], alice: transports[1], bob: transports[2], options };
}

test('default full mesh establishes exactly one bidirectional channel per pair', async (t) => {
  const { network, transports } = await room(t, {}, 4);
  for (const peer of network.peers.values()) {
    assert.equal([...peer.links].filter((link) => link.open).length, 3);
  }
  assert.equal([...network.peers.values()].reduce((sum, peer) =>
    sum + [...peer.links].filter((link) => link.open).length, 0) / 2, 6);
  const received = transports.map(() => []);
  transports.forEach((transport, index) => transport.onMessage((...message) => received[index].push(message)));
  transports[1].send('position', { x: 7 });
  await waitFor(() => received[3].length === 1);
  assert.deepEqual(received.map((messages) => messages.length), [1, 0, 1, 1]);
  assert.deepEqual(received[2][0], ['position', { x: 7 }, 'alice']);
  const hostLinks = [...network.peers.get('room').links];
  assert.equal(hostLinks.flatMap((link) => link.sent).filter((packet) => packet.type === 'message').length, 0);
});

test('mesh private messages travel directly and reject unavailable targets', async (t) => {
  const { host, alice, bob } = await room(t, { topology: 'full-mesh' });
  const received = [];
  const hostMessages = [];
  host.onMessage((...message) => hostMessages.push(message));
  bob.onMessage((...message) => received.push(message));
  alice.send('private', 'only bob', { targetId: 'bob' });
  await waitFor(() => received.length === 1);
  assert.deepEqual(received[0], ['private', 'only bob', 'alice']);
  assert.equal(hostMessages.length, 0);
  assert.throws(() => alice.send('private', 'missing', { targetId: 'unknown' }), /not connected/);
  assert.throws(() => alice.send('chat', 'bad', { reliable: false }), /only supports reliable/);
});

test('existing mesh peers communicate immediately after coordinator loss without election', async (t) => {
  const { host, alice, bob } = await room(t, { hostMigration: { mode: 'disabled', timeoutMs: 200 } });
  const received = [];
  bob.onMessage((...message) => received.push(message));
  host.disconnect();
  assert.equal(alice.isHost(), false);
  assert.equal(alice.isConnected(), true);
  assert.deepEqual(alice.getPeers(), ['bob']);
  alice.send('chat', 'no coordinator needed');
  await waitFor(() => received.length === 1);
  assert.equal(received[0][2], 'alice');
});

test('automatic mesh coordinator election preserves direct links and admits new joiners', async (t) => {
  const { network, host, alice, bob, options } = await room(t, { hostMigration: { timeoutMs: 30 } });
  const direct = [...network.peers.get('client-1').links].find((link) => link.peerId === 'client-2');
  host.disconnect();
  await waitFor(() => alice.isHost() && bob.getHost().userId === 'alice');
  assert.equal(direct.open, true);
  assert.equal(bob.isConnected(), true);
  const newcomer = new RtcHostTransport(network.createPeer);
  t.after(() => newcomer.disconnect());
  await newcomer.connect({
    ...options, role: 'client', userId: 'newcomer', hostPeerId: alice.getHost().peerId,
  });
  await waitFor(() => newcomer.getPeers().length === 2 && bob.getPeers().includes('newcomer'));
  const messages = [];
  newcomer.onMessage((...message) => messages.push(message));
  bob.send('chat', 'after election');
  await waitFor(() => messages.length === 1);
  assert.equal(messages[0][2], 'bob');
});

test('mesh election skips an unreachable first candidate without losing the survivor', async (t) => {
  const { host, alice, bob } = await room(t, { hostMigration: { timeoutMs: 30 } });
  host.disconnect();
  alice.disconnect();
  await waitFor(() => bob.isHost());
  assert.equal(bob.getHost().userId, 'bob');
  assert.equal(bob.isConnected(), true);
});

test('manual mesh coordinator handoff and repeated handoff do not rebuild direct channels', async (t) => {
  const { network, host, alice, bob } = await room(t, { hostMigration: { mode: 'manual', timeoutMs: 100 } });
  const originalLinks = [...network.peers.values()].flatMap((peer) => [...peer.links]);
  host.transferHost('bob');
  await waitFor(() => bob.isHost() && alice.getHost().userId === 'bob' && host.getHost().userId === 'bob');
  bob.transferHost('alice');
  await waitFor(() => alice.isHost() && host.getHost().userId === 'alice' && bob.getHost().userId === 'alice');
  assert.equal(originalLinks.every((link) => link.open), true);
  for (const transport of [host, alice, bob]) {
    assert.equal(transport.isConnected(), true);
    assert.equal(transport.getPeers().length, 2);
  }
});

test('mesh retries a failed pair without disturbing other routes', async (t) => {
  const { network, host, alice, bob } = await room(t);
  const link = [...network.peers.get('client-1').links].find((entry) => entry.peerId === 'client-2');
  link.close();
  assert.equal(alice.getPeers().includes('bob'), false);
  assert.equal(host.getPeers().length, 2);
  await waitFor(() => alice.getPeers().includes('bob') && bob.getPeers().includes('alice'));
  assert.equal([...network.peers.get('client-1').links].filter((entry) => entry.open).length, 2);
});

test('mesh honors disabled pair retries and reports incomplete broadcasts', async (t) => {
  const { network, alice } = await room(t, { reconnect: { enabled: false, intervalMs: 5 } });
  const errors = [];
  alice.onError((error) => errors.push(error.message));
  [...network.peers.get('client-1').links].find((entry) => entry.peerId === 'client-2').close();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(alice.getPeers().includes('bob'), false);
  alice.send('chat', 'partial delivery');
  assert.equal(errors.some((error) => error.includes('broadcast cannot reach: bob')), true);
});

test('mesh participant departure leaves remaining direct routes usable', async (t) => {
  const { host, alice, bob } = await room(t);
  alice.disconnect();
  await waitFor(() => host.getPeers().length === 1 && bob.getPeers().length === 1);
  const messages = [];
  host.onMessage((...message) => messages.push(message));
  bob.send('chat', 'still here');
  await waitFor(() => messages.length === 1);
  assert.equal(messages[0][2], 'bob');
});

test('a coordinator-only link failure does not tear down healthy direct routes', async (t) => {
  const { network, alice, bob } = await room(t, { hostMigration: { timeoutMs: 200 } });
  const coordinatorLink = [...network.peers.get('room').links].find((link) => link.peerId === 'client-1');
  coordinatorLink.close();
  assert.equal(alice.getPeers().includes('bob'), true);
  const received = [];
  bob.onMessage((...message) => received.push(message));
  alice.send('private', 'independent route', { targetId: 'bob' });
  await waitFor(() => received.length === 1);
  assert.equal(bob.getPeers().includes('alice'), true);
});

test('peer-specific signaling errors do not destroy healthy mesh routes', async (t) => {
  const { network, alice, bob } = await room(t);
  const peer = network.peers.get('client-1');
  const errors = [];
  alice.onError((error) => errors.push(error.message));
  for (const callback of peer.listeners.error) {
    callback(Object.assign(new Error('Unreachable remote peer.'), { type: 'peer-unavailable' }));
  }
  assert.equal(peer.destroyed, false);
  assert.equal(network.options.length, 3);
  const received = [];
  bob.onMessage((...message) => received.push(message));
  alice.send('chat', 'routes preserved', { targetId: 'bob' });
  await waitFor(() => received.length === 1);
  assert.deepEqual(errors, ['Unreachable remote peer.']);
});

test('mesh waits for roster admission when a direct connection arrives first', async (t) => {
  const network = new Network();
  const factory = (options) => {
    const peer = network.createPeer(options);
    if (peer.id === 'client-2') peer.rosterDelayMs = 40;
    return peer;
  };
  const transports = Array.from({ length: 3 }, () => new RtcHostTransport(factory));
  t.after(() => transports.forEach((transport) => transport.disconnect()));
  const options = {
    roomId: 'room', endpoint: 'https://peer.example.test',
    hostMigration: { timeoutMs: 300 }, reconnect: { intervalMs: 20 },
  };
  await transports[0].connect({ ...options, role: 'host', userId: 'host' });
  await transports[1].connect({ ...options, role: 'client', userId: 'alice' });
  const admission = transports[2].connect({ ...options, role: 'client', userId: 'bob' });
  await waitFor(() => [...network.peers.get('client-1').links]
    .some((link) => link.peerId === 'client-2' && link.open));
  assert.equal(transports[2].isConnected(), false);
  assert.equal(transports[1].getPeers().includes('bob'), false);
  assert.equal(transports[2].getPeers().includes('alice'), false);
  assert.throws(() => transports[1].send('chat', 'too early', { targetId: 'bob' }), /not connected/);
  await admission;
  await waitFor(() => transports[2].getPeers().includes('alice') && transports[1].getPeers().includes('bob'));
  const received = [];
  transports[2].onMessage((...message) => received.push(message));
  transports[1].send('chat', 'admitted', { targetId: 'bob' });
  await waitFor(() => received.length === 1);
  assert.equal(received[0][2], 'alice');
});

test('a direct neighbor cannot replace the coordinator or spoof sender identity', async (t) => {
  const { network, host, alice, bob } = await room(t);
  const received = [];
  const errors = [];
  bob.onMessage((...message) => received.push(message));
  bob.onError((error) => errors.push(error.message));
  const link = [...network.peers.get('client-1').links].find((entry) => entry.peerId === 'client-2');
  link.send({ type: 'migrate', term: 999, targetId: 'bob' });
  link.send({ type: 'roster', topology: 'full-mesh', term: 999, host: bob.getHost(), members: [] });
  link.send({ type: 'message', event: 'chat', payload: 'real origin', senderId: 'host' });
  await waitFor(() => received.length === 1 && errors.length === 2);
  assert.equal(bob.getHost().userId, 'host');
  assert.deepEqual(received[0], ['chat', 'real origin', 'alice']);
  assert.equal(host.isHost(), true);
  assert.equal(alice.isHost(), false);
});

test('mesh detects a silent coordinator without closing healthy peer-to-peer channels', async (t) => {
  const { network, alice, bob } = await room(t, { hostMigration: { timeoutMs: 45 } });
  network.peers.get('room').silent = true;
  await waitFor(() => alice.isHost());
  const messages = [];
  bob.onMessage((...message) => messages.push(message));
  alice.send('chat', 'healthy direct route', { targetId: 'bob' });
  await waitFor(() => messages.length === 1);
});

test('mesh peer recreation preserves ICE options and restores direct routes', async (t) => {
  const rtcConfiguration = { iceServers: [{ urls: 'turn:turn.example.test', username: 'temp', credential: 'temp' }] };
  const { network, transports, alice } = await room(t, { rtcConfiguration });
  network.peers.get('client-1').destroy();
  await waitFor(() => transports.every((transport) => transport.getPeers().length === 2));
  assert.equal(alice.isConnected(), true);
  assert.equal(network.options.at(-1).id, 'client-1');
  assert.deepEqual(network.options.at(-1).rtcConfiguration, rtcConfiguration);
});

test('duplicate mesh user IDs are rejected without displacing the admitted participant', async (t) => {
  const { network, host, alice, options } = await room(t);
  const duplicate = new RtcHostTransport(network.createPeer);
  t.after(() => duplicate.disconnect());
  await assert.rejects(duplicate.connect({ ...options, role: 'client', userId: 'alice' }), /closed/);
  assert.deepEqual(new Set(host.getPeers()), new Set(['alice', 'bob']));
  assert.equal(alice.isConnected(), true);
});

test('topology mismatches fail admission instead of silently mixing star and mesh', async (t) => {
  for (const topology of ['star', 'full-mesh']) {
    const network = new Network();
    const host = new RtcHostTransport(network.createPeer);
    const client = new RtcHostTransport(network.createPeer);
    t.after(() => { host.disconnect(); client.disconnect(); });
    await host.connect({ topology, role: 'host', roomId: 'room', userId: 'host', endpoint: 'https://peer.example.test' });
    await assert.rejects(client.connect({
      topology: topology === 'star' ? 'full-mesh' : 'star',
      role: 'client', roomId: 'room', userId: 'client', endpoint: 'https://peer.example.test',
    }), /closed|topology/);
  }
});

test('invalid topology is rejected without creating peers and disconnect clears mesh resources', async (t) => {
  const network = new Network();
  const transport = new RtcHostTransport(network.createPeer);
  await assert.rejects(transport.connect({
    topology: 'gossip', roomId: 'room', userId: 'host', endpoint: 'https://peer.example.test',
  }), /topology/);
  assert.equal(network.peers.size, 0);
  const { network: mesh, transports } = await room(t);
  transports.forEach((entry) => entry.disconnect());
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(mesh.peers.size, 0);
  assert.equal(transports.every((entry) => !entry.isConnected() && entry.getPeers().length === 0), true);
});
