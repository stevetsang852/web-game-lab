import assert from 'node:assert/strict';
import test from 'node:test';
import { RtcHostTransport } from '../dist/index.js';
import { Network, waitFor } from '../test-support/network.mjs';

async function room(t, hostMigration, reconnect = { intervalMs: 5 }) {
  const network = new Network();
  const transports = ['host', 'alice', 'bob'].map(() => new RtcHostTransport(network.createPeer));
  t.after(() => transports.forEach((transport) => transport.disconnect()));
  const options = { topology: 'star', roomId: 'room', endpoint: 'https://peer.example.test', reconnect };
  for (const [index, transport] of transports.entries()) {
    await transport.connect({
      ...options,
      userId: ['host', 'alice', 'bob'][index],
      role: index === 0 ? 'host' : 'client',
      hostMigration,
    });
  }
  await new Promise((resolve) => setImmediate(resolve));
  return { network, host: transports[0], alice: transports[1], bob: transports[2] };
}

test('default auto election replaces a disconnected host and restores client messaging', async (t) => {
  const { host, alice, bob } = await room(t, { timeoutMs: 10 });
  const events = [];
  alice.onHostChanged((event) => events.push(event));
  host.disconnect();
  await waitFor(() => alice.isHost() && alice.getPeers().includes('bob'));
  assert.equal(bob.getHost().userId, 'alice');
  assert.equal(events.at(-1).migrating, false);
  assert.equal(events.at(-1).reason, 'automatic');
  const messages = [];
  alice.onMessage((...message) => messages.push(message));
  bob.send('chat', 'after failover');
  await waitFor(() => messages.length === 1);
  assert.deepEqual(messages[0], ['chat', 'after failover', 'bob']);
});

test('automatic migration works when reconnect retries are disabled', async (t) => {
  const { host, alice, bob } = await room(t, { timeoutMs: 10 }, { enabled: false });
  host.disconnect();
  await waitFor(() => alice.isHost() && alice.getPeers().includes('bob'));
  assert.equal(bob.getHost().userId, 'alice');
  assert.equal(bob.isConnected(), true);
});

test('manual handoff moves the host and reconnects both other participants', async (t) => {
  const { host, alice, bob } = await room(t, { mode: 'manual', timeoutMs: 20 });
  assert.throws(() => alice.transferHost('bob'), /Only the connected host/);
  assert.throws(() => host.transferHost('unknown'), /not connected/);
  host.transferHost('bob');
  await waitFor(() => bob.isHost() && bob.getPeers().length === 2);
  assert.equal(host.isHost(), false);
  assert.equal(alice.getHost().userId, 'bob');
  assert.equal(host.getHost().peerId, bob.getHost().peerId);
  const received = [];
  bob.onMessage((...message) => received.push(message));
  host.send('move', { x: 1 });
  await waitFor(() => received.length === 1);
  assert.equal(received[0][2], 'host');
  bob.transferHost('alice');
  await waitFor(() => alice.isHost() && alice.getPeers().length === 2);
  assert.equal(host.getHost().userId, 'alice');
  assert.equal(bob.getHost().userId, 'alice');
});

test('manual mode never elects a successor after host failure', async (t) => {
  const { host, alice, bob } = await room(t, { mode: 'manual', timeoutMs: 5 });
  host.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.equal(alice.isHost(), false);
  assert.equal(bob.isHost(), false);
  assert.equal(alice.getHost().userId, 'host');
});

test('disabled mode rejects handoff and disconnect cancels pending elections', async (t) => {
  const { host, alice, bob } = await room(t, { mode: 'disabled', timeoutMs: 5 });
  assert.throws(() => host.transferHost('alice'), /disabled/);
  host.disconnect();
  alice.disconnect();
  bob.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(alice.isHost(), false);
  assert.equal(alice.getHost(), null);
});

test('a failed first candidate is skipped and the next remaining client becomes host', async (t) => {
  const { network, host, alice, bob } = await room(t, { timeoutMs: 10 });
  const alicePeer = [...network.peers.values()].find((peer) => peer.id === 'client-1');
  alice.disconnect();
  // Bob retains the last common membership when both failures happen together.
  host.disconnect();
  assert.equal(alicePeer.destroyed, true);
  await waitFor(() => bob.isHost());
  assert.equal(bob.getHost().userId, 'bob');
});

test('heartbeat expiry detects a silent host without a close notification', async (t) => {
  const { network, host, alice } = await room(t, { timeoutMs: 30 });
  const hostPeer = network.peers.get('room');
  hostPeer.silent = true;
  await waitFor(() => alice.isHost());
  assert.equal(alice.getHost().userId, 'alice');
  host.disconnect();
});

test('a healed host connection cancels election after heartbeat expiry', async (t) => {
  const { network, host, alice } = await room(t, { timeoutMs: 30 });
  const events = [];
  const errors = [];
  alice.onHostChanged((event) => events.push(event));
  alice.onError((error) => errors.push(error.message));
  const hostPeer = network.peers.get('room');
  const link = [...hostPeer.links].find((connection) => connection.peerId === 'client-1');
  link.blocked = true;
  await waitFor(() => errors.includes('RTC host heartbeat timed out.'));
  await waitFor(() => alice.isConnected());
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(events.length, 0);
  assert.equal(alice.getHost().userId, 'host');
  assert.equal(host.getPeers().length, 2);
});

test('disconnect during automatic election prevents later promotion and callbacks', async (t) => {
  const { host, alice } = await room(t, { timeoutMs: 20 });
  const events = [];
  alice.onHostChanged((event) => events.push(event));
  host.disconnect();
  alice.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(alice.isHost(), false);
  assert.equal(alice.isConnected(), false);
  assert.equal(alice.getHost(), null);
  assert.equal(events.length, 0);
});

test('disabled participants cannot be selected for manual handoff', async (t) => {
  const { network, host } = await room(t, { mode: 'manual', timeoutMs: 20 });
  const spectator = new RtcHostTransport(network.createPeer);
  t.after(() => spectator.disconnect());
  await spectator.connect({
    topology: 'star', role: 'client', roomId: 'room', userId: 'spectator',
    endpoint: 'https://peer.example.test', hostMigration: { mode: 'disabled' },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.throws(() => host.transferHost('spectator'), /cannot host/);
});

test('rejects invalid migration policies before creating a signaling peer', async () => {
  const network = new Network();
  const transport = new RtcHostTransport(network.createPeer);
  const options = { roomId: 'room', userId: 'host', endpoint: 'https://peer.example.test' };
  await assert.rejects(transport.connect({ ...options, hostMigration: { mode: 'unknown' } }), /mode/);
  for (const timeoutMs of [0, -1, NaN, Infinity]) {
    await assert.rejects(transport.connect({ ...options, hostMigration: { timeoutMs } }), /timeoutMs/);
  }
  assert.equal(network.peers.size, 0);
});

test('default auto policy waits five seconds before electing a successor', async (t) => {
  const { host, alice } = await room(t);
  host.disconnect();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(alice.isHost(), false);
  await new Promise((resolve) => setTimeout(resolve, 5_000));
  await waitFor(() => alice.isHost());
});

test('clients reject malformed rosters and stale or unknown manual handoffs', async (t) => {
  const { network, host, alice } = await room(t, { mode: 'manual', timeoutMs: 20 });
  const errors = [];
  alice.onError((error) => errors.push(error.message));
  const hostPeer = network.peers.get('room');
  const link = [...hostPeer.links].find((connection) => connection.peerId === 'client-1');
  link.send({ type: 'roster', term: 0, host: host.getHost(), members: [{ userId: 'imposter', peerId: 'unknown' }] });
  link.send({ type: 'migrate', term: 0, targetId: 'alice' });
  link.send({ type: 'migrate', term: 1, targetId: 'unknown' });
  await waitFor(() => errors.length === 3);
  assert.equal(alice.getHost().userId, 'host');
  assert.equal(alice.isHost(), false);
});
