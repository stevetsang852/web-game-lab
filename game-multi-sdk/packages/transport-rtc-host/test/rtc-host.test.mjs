import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { RtcHostTransport } from '../dist/index.js';

class FakeConnection {
  constructor(peerId, metadata = {}) {
    this.peerId = peerId;
    this.metadata = metadata;
    this.open = false;
    this.sent = [];
    this.callbacks = { open: [], data: [], close: [], error: [] };
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.open = false;
    for (const callback of this.callbacks.close) callback();
  }

  onOpen(callback) { this.callbacks.open.push(callback); }
  onData(callback) { this.callbacks.data.push(callback); }
  onClose(callback) { this.callbacks.close.push(callback); }
  onError(callback) { this.callbacks.error.push(callback); }

  emitOpen() {
    this.open = true;
    for (const callback of this.callbacks.open) callback();
  }

  emitData(data) {
    for (const callback of this.callbacks.data) callback(data);
  }

  emitError(error) {
    for (const callback of this.callbacks.error) callback(error);
  }
}

class FakePeer {
  constructor() {
    this.destroyed = false;
    this.connections = [];
    this.callbacks = { open: [], connection: [], close: [], error: [] };
  }

  connect(peerId, metadata) {
    this.outgoing = new FakeConnection(peerId, metadata);
    this.connections.push(this.outgoing);
    return this.outgoing;
  }

  destroy() { this.destroyed = true; }
  onOpen(callback) { this.callbacks.open.push(callback); }
  onConnection(callback) { this.callbacks.connection.push(callback); }
  onClose(callback) { this.callbacks.close.push(callback); }
  onError(callback) { this.callbacks.error.push(callback); }

  emitOpen(peerId = 'room-1') {
    for (const callback of this.callbacks.open) callback(peerId);
  }

  emitConnection(connection) {
    for (const callback of this.callbacks.connection) callback(connection);
  }

  emitClose() {
    for (const callback of this.callbacks.close) callback();
  }

  emitError(error) {
    for (const callback of this.callbacks.error) callback(error);
  }
}

const activeTransports = [];
afterEach(() => {
  for (const transport of activeTransports) transport.disconnect();
  activeTransports.length = 0;
});

function createHarness() {
  const peers = [];
  const peerOptions = [];
  const transport = new RtcHostTransport((options) => {
    peerOptions.push(options);
    const peer = new FakePeer();
    peers.push(peer);
    return peer;
  });
  activeTransports.push(transport);
  return { transport, peers, peerOptions };
}

async function connectHost(harness) {
  const pending = harness.transport.connect({
    topology: 'star',
    role: 'host',
    roomId: 'room-1',
    userId: 'host-user',
    endpoint: 'https://peer.example.test',
    reconnect: { intervalMs: 1 },
  });
  const peer = harness.peers[0];
  peer.emitOpen();
  await pending;
  return peer;
}

test('host connects, tracks clients, broadcasts messages, and cleans up', async () => {
  const harness = createHarness();
  const peer = await connectHost(harness);
  const peerChanges = [];
  harness.transport.onPeersChanged((ids) => peerChanges.push(ids));

  const first = new FakeConnection('room-1', { userId: 'player-1' });
  const second = new FakeConnection('room-1', { userId: 'player-2' });
  peer.emitConnection(first);
  peer.emitConnection(second);
  first.emitOpen();
  second.emitOpen();

  assert.equal(harness.transport.isHost(), true);
  assert.deepEqual(harness.transport.getPeers(), ['player-1', 'player-2']);
  assert.equal(first.sent[0].type, 'hello');
  assert.deepEqual(peerChanges.at(-1), ['player-1', 'player-2']);

  const received = [];
  harness.transport.onMessage((...message) => received.push(message));
  harness.transport.send('chat', { text: 'hello room' });
  assert.deepEqual(first.sent.at(-1), { type: 'message', event: 'chat', payload: { text: 'hello room' } });
  assert.deepEqual(second.sent.at(-1), first.sent.at(-1));

  harness.transport.send('private', { text: 'only player 2' }, { targetId: 'player-2' });
  assert.deepEqual(second.sent.at(-1), {
    type: 'message',
    event: 'private',
    payload: { text: 'only player 2' },
    targetId: 'player-2',
  });
  assert.equal(first.sent.at(-1).event, 'chat');

  first.emitData({ type: 'message', event: 'move', payload: { x: 4 } });
  assert.deepEqual(second.sent.at(-1), { type: 'message', event: 'move', payload: { x: 4 } });
  assert.deepEqual(received, [['move', { x: 4 }, 'player-1']]);

  first.close();
  assert.deepEqual(harness.transport.getPeers(), ['player-2']);
  harness.transport.disconnect();
  assert.equal(peer.destroyed, true);
  assert.deepEqual(harness.transport.getPeers(), []);
});

test('client connects to host and reports the host identity', async () => {
  const { transport, peers } = createHarness();
  const pending = transport.connect({
    topology: 'star',
    role: 'client',
    roomId: 'room-1',
    userId: 'player-1',
    endpoint: 'https://peer.example.test',
  });
  const peer = peers[0];
  peer.emitOpen();
  const connection = peer.outgoing;
  connection.emitOpen();
  await pending;

  assert.equal(connection.peerId, 'room-1');
  assert.deepEqual(connection.metadata, { userId: 'player-1' });
  assert.equal(transport.isHost(), false);
  assert.deepEqual(transport.getPeers(), ['room-1']);

  connection.emitData({ type: 'hello', userId: 'host-user' });
  assert.deepEqual(transport.getPeers(), ['host-user']);

  transport.send('chat', { text: 'hello host' });
  assert.deepEqual(connection.sent.at(-1), { type: 'message', event: 'chat', payload: { text: 'hello host' } });
  transport.send('chat', { text: 'direct to host' }, { targetId: 'host-user' });
  assert.deepEqual(connection.sent.at(-1), {
    type: 'message',
    event: 'chat',
    payload: { text: 'direct to host' },
    targetId: 'host-user',
  });
  transport.disconnect();
  assert.equal(peer.destroyed, true);
});

test('validates disconnected sends and unsupported unreliable delivery', async () => {
  const { transport } = createHarness();
  assert.throws(() => transport.send('chat', 'hello'), /not connected/);

  const { transport: host, peers } = createHarness();
  const pending = host.connect({
    topology: 'star',
    role: 'host',
    roomId: 'room-1',
    userId: 'host-user',
    endpoint: 'https://peer.example.test',
  });
  peers[0].emitOpen();
  await pending;
  assert.throws(() => host.send('chat', 'hello', { reliable: false }), /only supports reliable/);
  assert.throws(() => host.send('', 'hello'), /must not be empty/);
});

test('routes client-directed messages and rejects unknown targets', async () => {
  const harness = createHarness();
  const peer = await connectHost(harness);
  const first = new FakeConnection('room-1', { userId: 'player-1' });
  const second = new FakeConnection('room-1', { userId: 'player-2' });
  peer.emitConnection(first);
  peer.emitConnection(second);
  first.emitOpen();
  second.emitOpen();

  first.emitData({ type: 'message', event: 'private', payload: 'for player 2', targetId: 'player-2' });
  assert.deepEqual(second.sent.at(-1), { type: 'message', event: 'private', payload: 'for player 2' });

  const errors = [];
  harness.transport.onError((error) => errors.push(error.message));
  first.emitData({ type: 'message', event: 'private', payload: 'missing', targetId: 'missing-player' });
  assert.deepEqual(errors, ['RTC peer "missing-player" is not connected.']);
});

test('retries a lost client connection using the configured interval', async () => {
  const { transport, peers } = createHarness();
  const pending = transport.connect({
    topology: 'star',
    role: 'client',
    roomId: 'room-1',
    userId: 'player-1',
    endpoint: 'https://peer.example.test',
    reconnect: { intervalMs: 1 },
  });
  const peer = peers[0];
  peer.emitOpen();
  peer.outgoing.emitOpen();
  await pending;

  peer.outgoing.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(peer.connections.length, 2);
  peer.connections[1].emitOpen();
  assert.deepEqual(transport.getPeers(), ['room-1']);
  transport.disconnect();
});

test('recreates a lost signaling peer and stops retrying after disconnect', async () => {
  const harness = createHarness();
  const peer = await connectHost(harness);
  peer.emitClose();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(harness.peers.length, 2);
  assert.equal(peer.destroyed, true);
  harness.peers[1].emitOpen();
  assert.equal(harness.transport.isHost(), true);

  harness.transport.disconnect();
  harness.peers[1].emitClose();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(harness.peers.length, 2);
});

test('allows reconnect to be disabled and validates the retry interval', async () => {
  const { transport, peers } = createHarness();
  await assert.rejects(transport.connect({
    role: 'host',
    roomId: 'room-1',
    userId: 'host-user',
    endpoint: 'https://peer.example.test',
    reconnect: { intervalMs: 0 },
  }), /positive number/);

  const pending = transport.connect({
    topology: 'star',
    role: 'client',
    roomId: 'room-1',
    userId: 'player-1',
    endpoint: 'https://peer.example.test',
    reconnect: { enabled: false },
  });
  peers[0].emitOpen();
  peers[0].outgoing.emitOpen();
  await pending;
  peers[0].outgoing.close();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(peers[0].connections.length, 1);
  transport.disconnect();
});

test('rejects initial client connections that fail before opening', async () => {
  const { transport, peers } = createHarness();
  const pending = transport.connect({
    topology: 'star',
    role: 'client',
    roomId: 'room-1',
    userId: 'player-1',
    endpoint: 'https://peer.example.test',
  });
  peers[0].emitOpen();
  peers[0].outgoing.emitError(new Error('connection failed'));
  await assert.rejects(pending, /connection failed/);
});

for (const role of ['host', 'client']) {
  test(`forwards full RTC configuration for ${role} and preserves it when recreating the peer`, async (t) => {
    const { transport, peers, peerOptions } = createHarness();
    t.after(() => transport.disconnect());
    const rtcConfiguration = {
      iceServers: [{
        urls: ['turn:turn.example.test:3478', 'turns:turn.example.test:443?transport=tcp'],
        username: 'temporary-user',
        credential: 'temporary-credential',
      }],
      iceTransportPolicy: 'relay',
      bundlePolicy: 'max-bundle',
      iceCandidatePoolSize: 1,
    };
    const legacyServers = [{ urls: 'stun:legacy.example.test:3478' }];
    const pending = transport.connect({
      topology: 'star',
      role,
      roomId: 'room-1',
      userId: 'player-1',
      endpoint: 'https://peer.example.test',
      rtcConfiguration,
      iceServers: legacyServers,
      reconnect: { intervalMs: 1 },
    });
    peers[0].emitOpen();
    if (role === 'client') peers[0].outgoing.emitOpen();
    await pending;
    assert.deepEqual(peerOptions[0].rtcConfiguration, rtcConfiguration);
    assert.deepEqual(peerOptions[0].iceServers, legacyServers);

    peers[0].emitClose();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(peers.length, 2);
    assert.deepEqual(peerOptions[1].rtcConfiguration, rtcConfiguration);
    assert.deepEqual(peerOptions[1].iceServers, legacyServers);
    peers[1].emitOpen();
    if (role === 'client') peers[1].outgoing.emitOpen();
  });
}
