/**
 * Topology Strategy pattern.
 * Encapsulates Full Mesh vs Star routing and connection management differences.
 * See https://refactoring.guru/design-patterns/strategy
 */
import type { RtcDataConnection, RtcPeer, SendOptions, TransportOptions } from '@game-multi-sdk/core';

export interface TopologyContext {
  ownPeerId: string;
  hostPeerId: string;
  hostUserId: string;
  isHost: boolean;
  members: Array<{ userId: string; peerId: string; eligible?: boolean }>;
  transportOptions: TransportOptions | null;
  migrationMode: 'auto' | 'manual' | 'disabled';
  migrationTimeoutMs: number;
  reconnectEnabled: boolean;
  reconnectIntervalMs: number;
  awaitingHostConfirmation: boolean;
  peer: RtcPeer | null;
  emitError: (error: Error) => void;
  notifyPeersChanged: () => void;
  publishRoster: () => void;
  handlePacket: (data: unknown, role: 'host' | 'client', clientUserId?: string) => void;
  scheduleReconnect: (mode: 'client' | 'peer') => void;
  scheduleElection: () => void;
  clearReconnectTimer: () => void;
  setClientConnection: (conn: RtcDataConnection | null) => void;
  setConnected: (value: boolean) => void;
  setConnecting: (value: boolean) => void;
  setReconnectMode: (mode: 'client' | 'peer' | null) => void;
  getMembers: () => Array<{ userId: string; peerId: string; eligible?: boolean }>;
  setMembers: (members: Array<{ userId: string; peerId: string; eligible?: boolean }>) => void;
  addConnection: (userId: string, connection: RtcDataConnection) => void;
  getConnection: (userId: string) => RtcDataConnection | undefined;
  deleteConnection: (userId: string) => void;
}

export interface TopologyStrategy {
  readonly name: 'full-mesh' | 'star';

  onPeerOpen(context: TopologyContext, peer?: RtcPeer): void;

  acceptIncoming(
    context: TopologyContext,
    peer: RtcPeer,
    connection: RtcDataConnection,
    metadata?: unknown,
  ): void;

  connectCoordinator?(
    context: TopologyContext,
    peer: RtcPeer,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void;

  send(
    context: TopologyContext,
    event: string,
    payload: unknown,
    options?: SendOptions,
  ): void;

  getPeers(context: TopologyContext): string[];

  isConnected(context: TopologyContext): boolean;

  startMaintenance?(context: TopologyContext): void;

  stopMaintenance?(): void;

  reconcile?(context: TopologyContext): void;

  cleanup(): void;
}
