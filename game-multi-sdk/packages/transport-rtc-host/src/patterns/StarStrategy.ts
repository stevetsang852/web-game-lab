/**
 * Star topology strategy.
 * Clients connect only to the host; host relays broadcasts and direct messages.
 * Owns host connection map and client connection.
 * See https://refactoring.guru/design-patterns/strategy
 */
import type { RtcDataConnection, RtcPeer, SendOptions } from '@game-multi-sdk/core';
import type { TopologyContext, TopologyStrategy } from './TopologyStrategy.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getUserId(metadata: unknown): string | null {
  if (!isRecord(metadata) || typeof metadata.userId !== 'string' || !metadata.userId.trim()) return null;
  return metadata.userId;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const DATA_CHANNEL_OPEN_TIMEOUT_MS = 20_000;

export class StarStrategy implements TopologyStrategy {
  readonly name = 'star' as const;
  private clientConnection: RtcDataConnection | null = null;
  private hostConnections = new Map<string, RtcDataConnection>();
  private openTimer: ReturnType<typeof setTimeout> | null = null;

  onPeerOpen(_context: TopologyContext): void {
    // Host readiness and roster publish remain coordinated by transport.
  }

  acceptIncoming(context: TopologyContext, peer: RtcPeer, connection: RtcDataConnection): void {
    if (!context.isHost) {
      context.emitError(new Error('RTC incoming connection rejected: this peer is not the host.'));
      connection.close();
      return;
    }
    const userId = getUserId(connection.metadata);
    if (!userId || userId === context.transportOptions?.userId) {
      context.emitError(new Error('RTC client connection requires a unique non-host userId.'));
      connection.close();
      return;
    }
    this.listenHostConnection(context, peer, connection, userId);
  }

  connectCoordinator(
    context: TopologyContext,
    peer: RtcPeer,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    const hostPeerId = context.hostPeerId;
    try {
      const connection = peer.connect(hostPeerId, {
        userId: context.transportOptions?.userId,
        ...(context.migrationMode === 'disabled' ? { hostMigrationMode: 'disabled' } : {}),
      });
      this.clientConnection = connection;
      context.setClientConnection(connection);
      this.listenClientConnection(context, peer, connection, onReady, onFailure);
    } catch (error) {
      const connectionError = toError(error);
      if (onFailure) onFailure(connectionError);
      else context.emitError(connectionError);
    }
  }

  send(context: TopologyContext, event: string, payload: unknown, options?: SendOptions): void {
    const packet = {
      type: 'message' as const,
      event,
      payload,
      ...(options?.targetId ? { targetId: options.targetId } : {}),
    };
    if (context.isHost) {
      if (options?.targetId) {
        const connection = this.hostConnections.get(options.targetId);
        if (!connection?.open) {
          throw new Error(`RTC peer "${options.targetId}" is not connected.`);
        }
        connection.send(packet);
        return;
      }
      for (const connection of this.hostConnections.values()) {
        if (connection.open) connection.send(packet);
      }
      return;
    }
    if (options?.targetId && options.targetId !== context.hostPeerId && options.targetId !== context.hostUserId) {
      throw new Error(`RTC peer "${options.targetId}" is not connected.`);
    }
    if (!this.clientConnection?.open) {
      throw new Error('RTC host connection is not open.');
    }
    this.clientConnection.send(packet);
  }

  getPeers(context: TopologyContext): string[] {
    if (!context.isHost) return context.hostUserId ? [context.hostUserId] : [];
    return [...this.hostConnections.keys()];
  }

  isConnected(_context: TopologyContext): boolean {
    return true;
  }

  cleanup(): void {
    this.clearOpenTimer();
    this.clientConnection?.close();
    for (const c of this.hostConnections.values()) c.close();
    this.clientConnection = null;
    this.hostConnections.clear();
  }

  private clearOpenTimer(): void {
    if (this.openTimer !== null) clearTimeout(this.openTimer);
    this.openTimer = null;
  }

  getHostConnections(): Map<string, RtcDataConnection> {
    return this.hostConnections;
  }

  getClient(): RtcDataConnection | null {
    return this.clientConnection;
  }

  private listenHostConnection(
    context: TopologyContext,
    peer: RtcPeer,
    connection: RtcDataConnection,
    userId: string,
  ): void {
    connection.onOpen(() => {
      if (!context.isHost || context.peer !== peer) {
        connection.close();
        return;
      }
      const existing = this.hostConnections.get(userId);
      if (existing && existing !== connection) {
        context.emitError(new Error(`RTC user "${userId}" is already connected.`));
        connection.close();
        return;
      }
      this.hostConnections.set(userId, connection);
      context.addConnection(userId, connection);
      context.noteHostActivity();
      context.notifyPeersChanged();
      connection.send({ type: 'hello', userId: context.transportOptions?.userId });
      context.publishRoster();
    });
    connection.onData((data) => {
      if (this.hostConnections.get(userId) !== connection) return;
      context.noteHostActivity();
      context.handlePacket(data, 'host', userId);
    });
    connection.onClose(() => {
      if (this.hostConnections.get(userId) === connection) {
        this.hostConnections.delete(userId);
        context.deleteConnection(userId);
        context.publishRoster();
        context.notifyPeersChanged();
      }
    });
    connection.onError((error) => context.emitError(error));
  }

  private listenClientConnection(
    context: TopologyContext,
    peer: RtcPeer,
    connection: RtcDataConnection,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    let opened = false;
    let failed = false;
    const fail = (error: Error) => {
      if (failed || opened || this.clientConnection !== connection) return;
      failed = true;
      this.clearOpenTimer();
      if (onFailure) onFailure(error);
      else context.emitError(error);
    };
    this.clearOpenTimer();
    this.openTimer = setTimeout(() => {
      if (opened || connection.open) return;
      fail(new Error('RTC host data channel timed out before it opened.'));
      connection.close();
    }, Math.max(context.migrationTimeoutMs, DATA_CHANNEL_OPEN_TIMEOUT_MS));

    connection.onOpen(() => {
      if (this.clientConnection !== connection || context.peer !== peer) return;
      opened = true;
      this.clearOpenTimer();
      context.noteHostActivity();
      context.setConnected(true);
      context.setConnecting(false);
      context.setReconnectMode(null);
      context.clearReconnectTimer();
      onReady?.();
      context.notifyPeersChanged();
    });
    connection.onData((data) => {
      if (this.clientConnection !== connection) return;
      context.noteHostActivity();
      context.handlePacket(data, 'client');
    });
    connection.onClose(() => {
      this.clearOpenTimer();
      if (this.clientConnection !== connection) return;
      if (!opened) {
        fail(new Error('RTC host connection closed before the data channel opened.'));
        this.clientConnection = null;
        context.setClientConnection(null);
        return;
      }
      this.clientConnection = null;
      context.setClientConnection(null);
      context.setConnected(false);
      context.markHostUnconfirmed();
      context.notifyPeersChanged();
      context.scheduleReconnect('client');
      context.scheduleElection();
    });
    connection.onError((error) => {
      if (this.clientConnection !== connection) return;
      if (!opened) {
        fail(error);
        connection.close();
        return;
      }
      context.emitError(error);
      connection.close();
    });
  }
}
