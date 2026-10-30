import assert from 'node:assert/strict';

class Link {
  constructor(peerId, metadata) {
    this.peerId = peerId;
    this.metadata = metadata;
    this.open = false;
    this.closed = false;
    this.sent = [];
    this.listeners = { open: [], data: [], close: [], error: [] };
  }
  onOpen(callback) { this.listeners.open.push(callback); }
  onData(callback) { this.listeners.data.push(callback); }
  onClose(callback) { this.listeners.close.push(callback); }
  onError(callback) { this.listeners.error.push(callback); }
  emit(name, value) { for (const callback of this.listeners[name]) callback(value); }
  send(data) {
    if (!this.open) throw new Error('Fake link is closed.');
    this.sent.push(data);
    if (this.blocked || this.source?.silent) return;
    const remote = this.remote;
    const deliver = () => { if (remote.open) remote.emit('data', structuredClone(data)); };
    if (data.type === 'roster' && remote.source?.rosterDelayMs) {
      setTimeout(deliver, remote.source.rosterDelayMs);
    } else queueMicrotask(deliver);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit('close');
    if (this.remote && !this.remote.closed) {
      this.remote.closed = true;
      this.remote.open = false;
      this.remote.emit('close');
    }
  }
}

export class Network {
  peers = new Map();
  nextId = 0;
  options = [];
  createPeer = (options) => {
    this.options.push(options);
    const id = options.id ?? `client-${++this.nextId}`;
    assert.equal(this.peers.has(id), false, `Duplicate peer ID: ${id}`);
    const listeners = { open: [], connection: [], close: [], error: [] };
    const links = new Set();
    const peer = {
      id,
      destroyed: false,
      onOpen: (callback) => listeners.open.push(callback),
      onConnection: (callback) => listeners.connection.push(callback),
      onClose: (callback) => listeners.close.push(callback),
      onError: (callback) => listeners.error.push(callback),
      connect: (targetId, metadata) => {
        const outgoing = new Link(targetId, metadata);
        links.add(outgoing);
        queueMicrotask(() => {
          if (outgoing.closed || peer.destroyed) return;
          const target = this.peers.get(targetId);
          if (!target || target.destroyed) {
            outgoing.emit('error', new Error(`Peer ${targetId} is unavailable.`));
            return;
          }
          const incoming = new Link(id, metadata);
          incoming.source = target;
          outgoing.source = peer;
          target.links.add(incoming);
          outgoing.remote = incoming;
          incoming.remote = outgoing;
          for (const callback of target.listeners.connection) callback(incoming);
          if (incoming.closed || outgoing.closed) return;
          incoming.open = true;
          outgoing.open = true;
          incoming.emit('open');
          outgoing.emit('open');
        });
        return outgoing;
      },
      destroy: () => {
        if (peer.destroyed) return;
        peer.destroyed = true;
        this.peers.delete(id);
        for (const link of links) link.close();
        for (const callback of listeners.close) callback();
      },
      links,
      listeners,
    };
    this.peers.set(id, peer);
    queueMicrotask(() => {
      if (!peer.destroyed) for (const callback of listeners.open) callback(id);
    });
    return peer;
  };
}

export async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('Timed out waiting for RTC state.');
}
