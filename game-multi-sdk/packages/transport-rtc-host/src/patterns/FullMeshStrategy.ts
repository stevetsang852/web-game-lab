/**
 * Full Mesh topology strategy.
 * Owns all mesh connection state and lifecycle.
 * Each pair of peers maintains a direct DataChannel; coordinator only handles membership discovery.
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

/** ICE and DTLS often outlive the 5s host-migration deadline. Do not abort a join that early. */
const DATA_CHANNEL_OPEN_TIMEOUT_MS = 20_000;

export class FullMeshStrategy implements TopologyStrategy {
  readonly name = 'full-mesh' as const;

  private joined = false;
  private connections = new Map<string, RtcDataConnection>();
  private users = new Map<string, string>();
  private claims = new Map<string, string | null>();
  private remoteReady = new Set<string>();
  private readySent = new Set<string>();
  private activity = new Map<string, number>();
  private deadlines = new Map<RtcDataConnection, ReturnType<typeof setTimeout>>();
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private attempted = new Set<string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  onPeerOpen(context: TopologyContext): void {
    this.joined = true;
  }

  acceptIncoming(context: TopologyContext, peer: RtcPeer, connection: RtcDataConnection): void {
    const metadata = connection.metadata;
    const userId = getUserId(metadata);
    if (!isRecord(metadata) || metadata.roomId !== context.transportOptions?.roomId ||
        !userId || userId === context.transportOptions?.userId ||
        (metadata.purpose !== 'mesh' && metadata.purpose !== 'join') ||
        (metadata.purpose === 'join' && !context.isHost)) {
      context.emitError(new Error('RTC mesh connection has invalid room, identity, or coordinator metadata.'));
      connection.close();
      return;
    }
    const member = context.members.find((entry) => entry.peerId === connection.peerId);
    if (member && member.userId !== userId) {
      context.emitError(new Error('RTC mesh peer identity does not match the room roster.'));
      connection.close();
      return;
    }
    if (metadata.purpose === 'join' &&
        context.members.some((entry) => entry.userId === userId && entry.peerId !== connection.peerId)) {
      context.emitError(new Error(`RTC user "${userId}" is already connected.`));
      connection.close();
      return;
    }
    this.trackConnection(context, peer, connection, userId, metadata.purpose === 'join');
  }

  connectCoordinator(
    context: TopologyContext,
    peer: RtcPeer,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    const existing = this.connections.get(context.hostPeerId);
    if (existing) {
      context.setClientConnection(existing);
      if (existing.open) existing.send({ type: 'roster-request' });
      return;
    }
    try {
      const connection = peer.connect(context.hostPeerId, this.meshMetadata(context, 'join'));
      context.setClientConnection(connection);
      const member = context.members.find((entry) => entry.peerId === context.hostPeerId);
      this.trackConnection(context, peer, connection, member?.userId ?? null, false, onReady, onFailure);
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
    if (options?.targetId) {
      const entry = [...this.users].find(([peerId, userId]) =>
        userId === options.targetId || peerId === options.targetId);
      const connection = entry && this.connections.get(entry[0]);
      if (!connection?.open || !entry || !this.remoteReady.has(entry[0])) {
        throw new Error(`RTC peer "${options.targetId}" is not connected.`);
      }
      connection.send(packet);
    } else {
      const missing = context.members.filter((member) => member.peerId !== context.ownPeerId &&
        (!this.connections.get(member.peerId)?.open || !this.remoteReady.has(member.peerId)));
      if (missing.length) {
        context.emitError(new Error(`RTC mesh broadcast cannot reach: ${missing.map((member) => member.userId).join(', ')}.`));
      }
      for (const [peerId, connection] of this.connections) {
        if (connection.open && this.users.has(peerId) && this.remoteReady.has(peerId)) connection.send(packet);
      }
    }
  }

  getPeers(context: TopologyContext): string[] {
    if (!this.isAdmitted(context)) return [];
    return [...this.users]
      .filter(([peerId]) => this.connections.get(peerId)?.open && this.remoteReady.has(peerId))
      .map(([, userId]) => userId);
  }

  isConnected(context: TopologyContext): boolean {
    return this.isAdmitted(context);
  }

  private isAdmitted(context: TopologyContext): boolean {
    if (!this.joined) return false;
    if (context.isHost) return true;
    const userId = context.transportOptions?.userId;
    return context.members.some((member) => member.peerId === context.ownPeerId && member.userId === userId);
  }

  startMaintenance(context: TopologyContext): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [peerId, connection] of this.connections) {
        if (!connection.open) continue;
        if (Date.now() - (this.activity.get(peerId) ?? Date.now()) > context.migrationTimeoutMs) {
          context.emitError(new Error(`RTC mesh peer "${peerId}" heartbeat timed out.`));
          connection.close();
          continue;
        }
        connection.send({ type: 'heartbeat' });
        if (peerId === context.hostPeerId && context.awaitingHostConfirmation) {
          connection.send({ type: 'roster-request' });
        }
      }
    }, Math.max(1, Math.min(2_000, Math.floor(context.migrationTimeoutMs / 3))));
    if (this.retryTimer !== null) clearInterval(this.retryTimer);
    if (context.reconnectEnabled) {
      this.retryTimer = setInterval(() => this.reconcile(context), context.reconnectIntervalMs);
    }
    this.reconcile(context);
  }

  stopMaintenance(): void {
    for (const timer of this.deadlines.values()) clearTimeout(timer);
    this.deadlines.clear();
    if (this.retryTimer !== null) clearInterval(this.retryTimer);
    this.retryTimer = null;
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  reconcile(context: TopologyContext): void {
    const peer = context.peer;
    if (!peer) return;
    for (const member of context.members) {
      if (member.peerId === context.ownPeerId) continue;
      const connection = this.connections.get(member.peerId);
      if (connection) {
        const claim = this.claims.get(member.peerId);
        if (claim !== null && claim !== member.userId) {
          context.emitError(new Error('RTC mesh peer identity does not match the room roster.'));
          connection.close();
        } else if (connection.open) {
          this.users.set(member.peerId, member.userId);
          this.confirmReady(context, member.peerId, connection);
        }
        continue;
      }
      // Only the lower peer id dials. Two simultaneous offers glare and PeerJS aborts both
      // data channels, which is the "signaling works, DataChannel never opens" failure.
      if (context.ownPeerId > member.peerId) continue;
      if (!context.reconnectEnabled && this.attempted.has(member.peerId)) continue;
      this.attempted.add(member.peerId);
      try {
        this.trackConnection(context, peer, peer.connect(member.peerId, this.meshMetadata(context, 'mesh')), member.userId, false);
      } catch (error) {
        context.emitError(toError(error));
      }
    }
  }

  cleanup(): void {
    this.stopMaintenance();
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
    this.users.clear();
    this.claims.clear();
    this.remoteReady.clear();
    this.readySent.clear();
    this.activity.clear();
    this.attempted.clear();
    this.joined = false;
  }

  private meshMetadata(context: TopologyContext, purpose: 'join' | 'mesh'): Record<string, unknown> {
    const options = context.transportOptions;
    if (!options) throw new Error('RTC mesh transport has no active connection options.');
    return {
      userId: options.userId,
      roomId: options.roomId,
      topology: 'full-mesh',
      purpose,
      hostMigrationMode: context.migrationMode,
    };
  }

  private trackConnection(
    context: TopologyContext,
    peer: RtcPeer,
    connection: RtcDataConnection,
    claimedUserId: string | null,
    isJoin: boolean,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    const peerId = connection.peerId;
    if (this.connections.has(peerId)) {
      context.emitError(new Error(`RTC mesh already has a connection to "${peerId}".`));
      connection.close();
      return;
    }
    this.connections.set(peerId, connection);
    this.claims.set(peerId, claimedUserId);
    const current = () => context.peer === peer && this.connections.get(peerId) === connection;
    let channelOpen = false;
    let admitted = false;
    let initialFailed = false;
    const failInitial = (error: Error) => {
      if (initialFailed || admitted) return;
      initialFailed = true;
      // Reject the joiner's connect() so the demo can leave "Connecting" without a reload.
      if (onFailure && peerId === context.hostPeerId) onFailure(error);
      else context.emitError(error);
    };
    const armDeadline = (delayMs: number, phase: 'open' | 'ready') => {
      this.clearDeadline(connection);
      const deadline = setTimeout(() => {
        if (!current()) return;
        if (phase === 'open') {
          if (channelOpen || connection.open) return;
          failInitial(new Error(`RTC mesh connection to "${peerId}" timed out before the data channel opened.`));
          connection.close();
          return;
        }
        if (peerId === context.hostPeerId && onReady && !admitted) {
          failInitial(new Error(`RTC mesh connection to "${peerId}" timed out.`));
          connection.close();
          return;
        }
        if (this.remoteReady.has(peerId)) return;
        context.emitError(new Error(`RTC mesh connection to "${peerId}" timed out.`));
        connection.close();
      }, delayMs);
      this.deadlines.set(connection, deadline);
    };
    armDeadline(Math.max(DATA_CHANNEL_OPEN_TIMEOUT_MS, context.migrationTimeoutMs), 'open');

    connection.onOpen(() => {
      if (!current()) return;
      channelOpen = true;
      const userId = claimedUserId ?? this.users.get(peerId);
      if (userId) this.users.set(peerId, userId);
      this.activity.set(peerId, Date.now());
      if (isJoin) {
        context.addConnection(userId ?? peerId, connection);
        context.publishRoster();
      }
      this.confirmReady(context, peerId, connection);
      // mesh-ready / roster admission is a separate deadline from ICE.
      if (!(admitted && this.remoteReady.has(peerId))) armDeadline(context.migrationTimeoutMs, 'ready');
      context.notifyPeersChanged();
    });

    connection.onData((data) => {
      if (!current()) return;
      this.activity.set(peerId, Date.now());
      if (isRecord(data) && data.type === 'mesh-ready') {
        this.remoteReady.add(peerId);
        if (admitted || peerId !== context.hostPeerId) this.clearDeadline(connection);
        context.notifyPeersChanged();
        return;
      }
      if (isRecord(data) && data.type === 'heartbeat') return;
      const userId = this.users.get(peerId) ?? claimedUserId;
      const type = isRecord(data) ? data.type : '';
      const control = type === 'roster' || type === 'migrate' || type === 'hello';
      if (control && peerId !== context.hostPeerId) {
        context.emitError(new Error('RTC mesh ignored a control packet that did not come from the coordinator.'));
        return;
      }
      // Roster must be accepted before the remote userId is known, or the joiner never sends mesh-ready.
      if (!userId && !control) return;
      context.handlePacket(data, context.isHost && isJoin ? 'host' : 'client', userId ?? undefined);
      if (type !== 'roster') return;
      this.syncFromRoster(context);
      const admittedByRoster = context.members.some((member) =>
        member.peerId === context.ownPeerId && member.userId === context.transportOptions?.userId);
      if (!admitted && admittedByRoster && onReady && peerId === context.hostPeerId) {
        admitted = true;
        this.clearDeadline(connection);
        context.setConnected(true);
        context.setConnecting(false);
        context.setReconnectMode(null);
        context.clearReconnectTimer();
        onReady();
      }
    });

    connection.onClose(() => {
      if (!current()) return;
      this.clearDeadline(connection);
      this.connections.delete(peerId);
      this.users.delete(peerId);
      this.claims.delete(peerId);
      this.remoteReady.delete(peerId);
      this.readySent.delete(peerId);
      this.activity.delete(peerId);
      if (context.reconnectEnabled) this.attempted.delete(peerId);
      if (isJoin && claimedUserId) context.deleteConnection(claimedUserId);
      context.notifyPeersChanged();
      if (!admitted && peerId === context.hostPeerId) {
        failInitial(new Error(channelOpen
          ? `RTC mesh connection to "${peerId}" closed before the room admitted this peer.`
          : `RTC mesh connection to "${peerId}" closed before the data channel opened.`));
        return;
      }
      if (peerId === context.hostPeerId) {
        context.setClientConnection(null);
        context.setConnected(false);
        context.scheduleReconnect('client');
        context.scheduleElection();
      }
    });

    connection.onError((error) => {
      if (!channelOpen && !connection.open && peerId === context.hostPeerId) {
        failInitial(error);
        connection.close();
        return;
      }
      context.emitError(error);
      if (!connection.open) connection.close();
    });
  }

  private clearDeadline(connection: RtcDataConnection): void {
    const timer = this.deadlines.get(connection);
    if (timer !== undefined) clearTimeout(timer);
    this.deadlines.delete(connection);
  }

  /** Learn user ids from the live roster, finish mesh-ready, and dial missing direct edges. */
  private syncFromRoster(context: TopologyContext): void {
    for (const member of context.members) {
      if (member.peerId === context.ownPeerId) continue;
      const connection = this.connections.get(member.peerId);
      if (!connection) continue;
      this.users.set(member.peerId, member.userId);
      this.claims.set(member.peerId, member.userId);
      if (connection.open) this.confirmReady(context, member.peerId, connection);
    }
    this.reconcile(context);
  }

  private confirmReady(context: TopologyContext, peerId: string, connection: RtcDataConnection): void {
    if (!this.joined || !this.users.has(peerId) || !connection.open) return;
    // Direct edges stay quiet until this peer has been admitted, so a half-joined
    // client cannot appear in anyone else's party list.
    if (!this.isAdmitted(context) && peerId !== context.hostPeerId) return;
    if (!this.readySent.has(peerId)) {
      this.readySent.add(peerId);
      connection.send({ type: 'mesh-ready' });
    }
  }

  // Accessors for transport during transition
  getConnections(): Map<string, RtcDataConnection> { return this.connections; }
  getLinkedUser(peerId: string): string | null {
    return this.users.get(peerId) ?? this.claims.get(peerId) ?? null;
  }
  isJoined(): boolean { return this.joined; }
}
