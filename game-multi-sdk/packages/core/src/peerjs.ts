import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { resolveRtcConfiguration, type RtcConfigurationOptions } from './rtc-configuration.js';

export interface RtcPeerOptions extends RtcConfigurationOptions {
  /** A fixed PeerJS ID for a host; omit to let PeerJS assign one. */
  id?: string;
  /** Absolute URL of a PeerJS-compatible signaling server. */
  signalingEndpoint: string;
}

export interface RtcDataConnection {
  readonly peerId: string;
  readonly metadata: unknown;
  readonly open: boolean;
  send(data: unknown): void;
  close(): void;
  onOpen(callback: () => void): void;
  onData(callback: (data: unknown) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
}

export interface RtcPeer {
  readonly destroyed: boolean;
  connect(peerId: string, metadata?: unknown): RtcDataConnection;
  destroy(): void;
  onOpen(callback: (peerId: string) => void): void;
  onConnection(callback: (connection: RtcDataConnection) => void): void;
  onClose(callback: () => void): void;
  onError(callback: (error: Error) => void): void;
}

const DEFAULT_STUN_URLS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

/** Create a PeerJS-backed peer while keeping PeerJS types out of consumer packages. */
export function createRtcPeer(options: RtcPeerOptions): RtcPeer {
  const peerOptions = getPeerOptions(options);
  const peer = options.id === undefined
    ? new Peer(peerOptions)
    : new Peer(options.id, peerOptions);

  return {
    get destroyed() {
      return peer.destroyed;
    },
    connect(peerId, metadata) {
      return wrapDataConnection(peer.connect(peerId, {
        reliable: true,
        ...(metadata === undefined ? {} : { metadata }),
      }));
    },
    destroy() {
      peer.destroy();
    },
    onOpen(callback) {
      peer.on('open', callback);
    },
    onConnection(callback) {
      peer.on('connection', (connection) => callback(wrapDataConnection(connection)));
    },
    onClose(callback) {
      peer.on('close', callback);
    },
    onError(callback) {
      peer.on('error', (error) => callback(toError(error)));
    },
  };
}

function wrapDataConnection(connection: DataConnection): RtcDataConnection {
  return {
    get peerId() {
      return connection.peer;
    },
    get metadata() {
      return connection.metadata;
    },
    get open() {
      return connection.open;
    },
    send(data) {
      connection.send(data);
    },
    close() {
      connection.close();
    },
    onOpen(callback) {
      connection.on('open', callback);
    },
    onData(callback) {
      connection.on('data', callback);
    },
    onClose(callback) {
      connection.on('close', callback);
    },
    onError(callback) {
      connection.on('error', (error) => callback(toError(error)));
    },
  };
}

function getPeerOptions(options: RtcPeerOptions): PeerOptions {
  const endpoint = options.signalingEndpoint;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error(`Invalid PeerJS signaling endpoint "${endpoint}". Use an absolute URL.`);
  }

  const secure = url.protocol === 'https:' || url.protocol === 'wss:';
  if (!secure && url.protocol !== 'http:' && url.protocol !== 'ws:') {
    throw new Error(`Unsupported PeerJS signaling protocol "${url.protocol}".`);
  }

  const resolved = resolveRtcConfiguration(options);
  const iceServers = resolved?.iceServers && resolved.iceServers.length > 0
    ? resolved.iceServers
    : [{ urls: DEFAULT_STUN_URLS }];

  const config: RTCConfiguration = {
    ...resolved,
    iceServers,
    iceCandidatePoolSize: resolved?.iceCandidatePoolSize ?? 10,
  };

  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : (secure ? 443 : 80),
    path: url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, ''),
    secure,
    config,
  };
}

function toError(error: Error): Error {
  return error instanceof Error ? error : new Error(String(error));
}
