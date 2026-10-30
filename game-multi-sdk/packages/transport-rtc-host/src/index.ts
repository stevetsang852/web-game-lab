import type {
  GameCategory,
  HostChangedHandler,
  HostChangedEvent,
  HostInfo,
  IGameTransport,
  MessageHandler,
  PeersChangedHandler,
  RtcDataConnection,
  RtcPeer,
  RtcPeerOptions,
  RtcTopology,
  SendOptions,
  TransportErrorHandler,
  TransportOptions,
} from '@game-multi-sdk/core';
import { DefaultConnectionStateMachine } from './patterns/ConnectionStateMachine';
import type { ConnectionStateName } from './patterns/ConnectionStateMachine';
import { EventBus } from './patterns/EventBus';
import { FullMeshStrategy } from './patterns/FullMeshStrategy';
import { StarStrategy } from './patterns/StarStrategy';
import type { TopologyStrategy, TopologyContext } from './patterns/TopologyStrategy';

type RtcPeerFactory = (options: RtcPeerOptions) => RtcPeer;

interface WireMessage {
  type: 'message';
  event: string;
  payload: unknown;
  targetId?: string;
}

interface WireHello {
  type: 'hello';
  userId: string;
}

interface RoomMember extends HostInfo {
  eligible?: boolean;
}

interface TransportEvents {
  message: { event: string; payload: unknown; senderId: string };
  peersChanged: string[];
  error: Error;
  hostChanged: HostChangedEvent;
}

export class RtcHostTransport implements IGameTransport {
  readonly category: GameCategory = 'RTC_HOST';
  private readonly createPeer?: RtcPeerFactory;
  private readonly stateMachine = new DefaultConnectionStateMachine();
  private readonly events = new EventBus<TransportEvents>();
  private strategy: TopologyStrategy | null = null;

  constructor(createPeer?: RtcPeerFactory) {
    this.createPeer = createPeer;
  }

  /** Current high-level connection state (State pattern). */
  get connectionState(): ConnectionStateName {
    return this.stateMachine.state;
  }

  private peer: RtcPeer | null = null;
  private connections = new Map<string, RtcDataConnection>();
  private clientConnection: RtcDataConnection | null = null;
  private hostPeerId = '';
  private hostUserId = '';
  private role: 'host' | 'client' | null = null;
  private connected = false;
  private connecting = false;
  private reconnectEnabled = true;
  private reconnectIntervalMs = 5_000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectMode: 'client' | 'peer' | null = null;
  private manuallyDisconnected = false;
  private transportOptions: TransportOptions | null = null;
  private ownPeerId = '';
  private migrationMode: 'auto' | 'manual' | 'disabled' = 'auto';
  private migrationTimeoutMs = 5_000;
  private migrationTimer: ReturnType<typeof setTimeout> | null = null;
  private members: RoomMember[] = [];
  private failedCandidates = new Set<string>();
  private migrationEvent: HostChangedEvent | null = null;
  private roomTerm = 0;
  private retiredConnections = new Set<RtcDataConnection>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastHostActivity = 0;
  private awaitingHostConfirmation = false;
  private topology: RtcTopology = 'full-mesh';
  // All notifications go through EventBus (Observer pattern).

  async connect(options: TransportOptions): Promise<void> {
    if (this.peer || this.connecting || this.transportOptions) {
      throw new Error('RTC transport is already connected or connecting.');
    }

    const role = options.role ?? 'host';
    if (role !== 'host' && role !== 'client') {
      throw new Error(`Unsupported RTC transport role "${String(role)}".`);
    }
    const topology = options.topology ?? 'full-mesh';
    if (topology !== 'full-mesh' && topology !== 'star') {
      throw new Error('RTC topology must be full-mesh or star.');
    }
    if (!options.roomId.trim() || !options.userId.trim()) {
      throw new Error('RTC roomId and userId must not be empty.');
    }
    const reconnectIntervalMs = options.reconnect?.intervalMs ?? 5_000;
    if (!Number.isFinite(reconnectIntervalMs) || reconnectIntervalMs <= 0) {
      throw new Error('RTC reconnect intervalMs must be a positive number.');
    }
    const migrationMode = options.hostMigration?.mode ?? 'auto';
    if (!['auto', 'manual', 'disabled'].includes(migrationMode)) {
      throw new Error('RTC host migration mode must be auto, manual, or disabled.');
    }
    const migrationTimeoutMs = options.hostMigration?.timeoutMs ?? 5_000;
    if (!Number.isFinite(migrationTimeoutMs) || migrationTimeoutMs <= 0) {
      throw new Error('RTC host migration timeoutMs must be a positive number.');
    }
    const hostPeerId = options.hostPeerId ?? options.roomId;
    if (role === 'client' && !hostPeerId) {
      throw new Error('A host PeerJS ID is required for a client connection.');
    }

    this.connecting = true;
    this.stateMachine.transition('signaling');
    this.manuallyDisconnected = false;
    this.reconnectEnabled = options.reconnect?.enabled ?? true;
    this.reconnectIntervalMs = reconnectIntervalMs;
    this.transportOptions = options;
    this.topology = topology;
    this.strategy = topology === 'full-mesh' ? new FullMeshStrategy() : new StarStrategy();
    this.migrationMode = migrationMode;
    this.migrationTimeoutMs = migrationTimeoutMs;
    this.role = role;
    this.hostPeerId = hostPeerId;
    this.hostUserId = role === 'host' ? options.userId : hostPeerId;

    let peer: RtcPeer;
    try {
      const createPeer = this.createPeer ?? (await import('@game-multi-sdk/core')).createRtcPeer;
      if (this.manuallyDisconnected || !this.connecting) {
        throw new Error('RTC connection was disconnected before the peer was created.');
      }
      peer = createPeer({
        ...(role === 'host' ? { id: options.roomId } : {}),
        signalingEndpoint: options.endpoint,
        ...(options.rtcConfiguration ? { rtcConfiguration: options.rtcConfiguration } : {}),
        ...(options.iceServers ? { iceServers: options.iceServers } : {}),
      });
    } catch (error) {
      this.connecting = false;
      this.role = null;
      this.transportOptions = null;
      const peerError = toError(error);
      this.emitError(peerError);
      throw peerError;
    }
    this.peer = peer;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.connecting = false;
        this.connected = true;
        resolve();
      };
      const fail = (error: Error) => {
        this.emitError(error);
        if (settled) return;
        settled = true;
        this.connecting = false;
        this.disconnect();
        reject(error);
      };
      this.setupPeer(peer, options, finish, fail);
    });
  }

  disconnect(): void {
    this.manuallyDisconnected = true;
    if (this.stateMachine.canTransition('closed')) this.stateMachine.transition('closed');
    this.clearReconnectTimer();
    this.clearMigrationTimer();
    this.stopHeartbeat();
    this.strategy?.cleanup();
    this.strategy = null;
    const peer = this.peer;
    this.peer = null;
    this.connected = false;
    this.connecting = false;
    this.role = null;
    this.reconnectMode = null;
    this.transportOptions = null;
    this.members = [];
    this.failedCandidates.clear();
    this.migrationEvent = null;
    this.roomTerm = 0;
    this.ownPeerId = '';
    this.awaitingHostConfirmation = false;

    const connections = [...this.connections.values()];
    connections.push(...this.retiredConnections);
    this.retiredConnections.clear();
    if (this.clientConnection) connections.push(this.clientConnection);
    this.connections.clear();
    this.clientConnection = null;
    this.hostUserId = this.hostPeerId;

    for (const connection of new Set(connections)) connection.close();
    peer?.destroy();
    this.notifyPeersChanged();
  }

  send(event: string, payload: unknown, options?: SendOptions): void {
    if (!this.isConnected()) throw new Error('RTC transport is not connected.');
    if (options?.reliable === false) {
      throw new Error('RTC transport only supports reliable delivery.');
    }
    if (!event) throw new Error('RTC message event must not be empty.');

    const packet: WireMessage = {
      type: 'message',
      event,
      payload,
      ...(options?.targetId ? { targetId: options.targetId } : {}),
    };
    if (this.strategy) {
      this.strategy.send(this.buildTopologyContext(), event, payload, options);
      return;
    }
    throw new Error('RTC transport has no topology strategy.');
  }

  onMessage(callback: MessageHandler): () => void {
    return this.events.on('message', (data) => callback(data.event, data.payload, data.senderId));
  }

  onPeersChanged(callback: PeersChangedHandler): () => void {
    return this.events.on('peersChanged', callback);
  }

  onError(callback: TransportErrorHandler): () => void {
    return this.events.on('error', callback);
  }

  onHostChanged(callback: HostChangedHandler): () => void {
    return this.events.on('hostChanged', callback);
  }

  getHost(): HostInfo | null {
    if (!this.transportOptions) return null;
    return { userId: this.hostUserId, peerId: this.hostPeerId };
  }

  transferHost(targetId: string): void {
    if (this.migrationMode === 'disabled') throw new Error('RTC host migration is disabled.');
    if (!this.isHost() || !this.connected) throw new Error('Only the connected host can transfer the room.');
    const connection = this.connections.get(targetId);
    const target = this.members.find((member) => member.userId === targetId);
    if (!connection?.open || !target || target.eligible === false) {
      throw new Error(`RTC migration target "${targetId}" is not connected or cannot host.`);
    }
    const term = this.roomTerm + 1;
    const packet = { type: 'migrate', term, targetId };
    // Keep old routes alive until clients receive the handoff and connect to the successor.
    for (const recipient of this.connections.values()) recipient.send(packet);
    this.adoptHost(target, term, 'manual');
  }

  getPeers(): string[] {
    if (this.strategy) return this.strategy.getPeers(this.buildTopologyContext());
    return [];
  }

  isConnected(): boolean {
    if (this.strategy) return this.strategy.isConnected(this.buildTopologyContext()) && this.peer !== null;
    return this.connected;
  }

  private buildTopologyContext(): TopologyContext {
    return {
      ownPeerId: this.ownPeerId,
      hostPeerId: this.hostPeerId,
      hostUserId: this.hostUserId,
      isHost: this.isHost(),
      members: this.members,
      transportOptions: this.transportOptions,
      migrationMode: this.migrationMode,
      migrationTimeoutMs: this.migrationTimeoutMs,
      reconnectEnabled: this.reconnectEnabled,
      reconnectIntervalMs: this.reconnectIntervalMs,
      awaitingHostConfirmation: this.awaitingHostConfirmation,
      peer: this.peer,
      emitError: (e) => this.emitError(e),
      notifyPeersChanged: () => this.notifyPeersChanged(),
      publishRoster: () => this.publishRoster(),
      handlePacket: (data, role, clientUserId) => this.handlePacket(data, role, clientUserId),
      scheduleReconnect: (mode) => this.scheduleReconnect(mode),
      scheduleElection: () => this.scheduleElection(),
      clearReconnectTimer: () => this.clearReconnectTimer(),
      setClientConnection: (conn) => { this.clientConnection = conn; },
      setConnected: (value) => { this.connected = value; },
      setConnecting: (value) => { this.connecting = value; },
      setReconnectMode: (mode) => { this.reconnectMode = mode; },
      getMembers: () => this.members,
      setMembers: (members) => { this.members = members; },
      addConnection: (userId, connection) => { this.connections.set(userId, connection); },
      getConnection: (userId) => this.connections.get(userId),
      deleteConnection: (userId) => { this.connections.delete(userId); },
    };
  }

  private listenToConnection(
    connection: RtcDataConnection,
    role: 'host' | 'client',
    onOpen: () => void,
    clientUserId?: string,
    onInitialFailure?: (error: Error) => void,
  ): void {
    connection.onOpen(onOpen);
    connection.onData((data) => {
      const current = role === 'host'
        ? this.isHost() && this.connections.get(clientUserId ?? '') === connection
        : this.role === 'client' && this.clientConnection === connection;
      if (current) {
        if (role === 'client') this.lastHostActivity = Date.now();
        this.handlePacket(data, role, clientUserId);
      }
    });
    connection.onClose(() => {
      if (this.manuallyDisconnected) return;
      if (role === 'host' && clientUserId) {
        if (this.connections.get(clientUserId) === connection) {
          this.connections.delete(clientUserId);
          this.publishRoster();
          this.notifyPeersChanged();
        }
      } else if (this.clientConnection === connection) {
        if (this.connecting && onInitialFailure) {
          onInitialFailure(new Error('RTC host connection closed before opening.'));
          return;
        }
        this.clientConnection = null;
        this.awaitingHostConfirmation = true;
        this.connected = false;
        this.notifyPeersChanged();
        if (this.migrationEvent) this.scheduleElection();
        else {
          this.scheduleReconnect('client');
          this.scheduleElection();
        }
      }
    });
    connection.onError((error) => {
      if (role === 'client' && this.clientConnection === connection) {
        if (this.connecting && onInitialFailure) {
          onInitialFailure(error);
          return;
        }
        this.emitError(error);
        connection.close();
        return;
      }
      this.emitError(error);
    });
  }

  private setupPeer(
    peer: RtcPeer,
    options: TransportOptions,
    onInitialReady?: () => void,
    onInitialFailure?: (error: Error) => void,
  ): void {
    peer.onError((error) => {
      if (this.peer !== peer || this.manuallyDisconnected) return;
      if (this.connecting && onInitialFailure) {
        onInitialFailure(error);
        return;
      }
      this.emitError(error);
      if (this.topology === 'full-mesh' && !peer.destroyed && isRecord(error) &&
          (error.type === 'peer-unavailable' || error.type === 'webrtc')) return;
      this.handlePeerLost(peer);
    });
    peer.onClose(() => {
      if (this.peer !== peer || this.manuallyDisconnected) return;
      if (this.connecting && onInitialFailure) {
        onInitialFailure(new Error('RTC signaling peer closed before connecting.'));
        return;
      }
      this.emitError(new Error('RTC signaling peer closed.'));
      this.handlePeerLost(peer);
    });
    peer.onOpen((peerId) => {
      if (this.peer !== peer || this.manuallyDisconnected) return;
      this.ownPeerId = peerId;
      this.startHeartbeat();
      // Both host and client must mark the strategy as joined so mesh-ready handshake can proceed.
      if (this.topology === 'full-mesh') {
        this.strategy?.onPeerOpen(this.buildTopologyContext());
      }
      if (this.isHost()) {
        this.hostPeerId = peerId;
        this.hostUserId = options.userId;
        this.connected = true;
        if (this.stateMachine.canTransition('connected')) this.stateMachine.transition('connected');
        if (this.topology === 'full-mesh') {
          this.publishRoster();
        }
        this.connecting = false;
        onInitialReady?.();
        this.notifyPeersChanged();
        return;
      }
      this.connectClient(peer, options, onInitialReady, onInitialFailure);
      if (this.awaitingHostConfirmation) this.scheduleElection();
    });

    peer.onConnection((connection) => {
        if (this.peer !== peer || this.manuallyDisconnected) {
          connection.close();
          return;
        }
        const remoteTopology = isRecord(connection.metadata) ? connection.metadata.topology ?? 'star' : 'star';
        if (remoteTopology !== this.topology) {
          this.emitError(new Error('RTC topology mismatch: all room participants must use the same topology.'));
          connection.close();
          return;
        }
        if (this.strategy) {
          this.strategy.acceptIncoming(this.buildTopologyContext(), peer, connection);
          return;
        }
        connection.close();
      });
  }

  private connectClient(
    peer: RtcPeer,
    options: TransportOptions,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    if (this.strategy?.connectCoordinator) {
      this.strategy.connectCoordinator(this.buildTopologyContext(), peer, onReady, onFailure);
      return;
    }
    onFailure?.(new Error('RTC transport has no topology strategy for client connect.'));
  }

  private handlePeerLost(peer: RtcPeer): void {
    if (this.peer !== peer) return;
    this.peer = null;
    this.stopHeartbeat();
    this.strategy?.cleanup();
    this.connected = false;
    if (this.role === 'client') this.awaitingHostConfirmation = true;
    this.connecting = false;
    const connections = [...this.connections.values()];
    if (this.clientConnection) connections.push(this.clientConnection);
    this.connections.clear();
    this.clientConnection = null;
    for (const connection of new Set(connections)) connection.close();
    peer.destroy();
    this.notifyPeersChanged();
    this.scheduleReconnect('peer');
  }

  private scheduleReconnect(mode: 'client' | 'peer'): void {
    if (!this.reconnectEnabled || this.manuallyDisconnected || !this.transportOptions) return;
    if (mode === 'peer' || this.reconnectMode === null) this.reconnectMode = mode;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const reconnectMode = this.reconnectMode;
      this.reconnectMode = null;
      if (this.manuallyDisconnected || !this.transportOptions) return;
      if (reconnectMode === 'peer') {
        void this.recreatePeer();
      } else if (reconnectMode === 'client') {
        const peer = this.peer;
        if (peer && !peer.destroyed) this.connectClient(peer, this.transportOptions);
        else this.scheduleReconnect('peer');
      }
    }, this.reconnectIntervalMs);
  }

  private async recreatePeer(): Promise<void> {
    const options = this.transportOptions;
    if (!options || this.manuallyDisconnected || this.peer) return;
    try {
      const createPeer = this.createPeer ?? (await import('@game-multi-sdk/core')).createRtcPeer;
      if (this.manuallyDisconnected || this.peer || this.transportOptions !== options) return;
      const peer = createPeer({
        ...(this.ownPeerId ? { id: this.ownPeerId } : {}),
        signalingEndpoint: options.endpoint,
        ...(options.rtcConfiguration ? { rtcConfiguration: options.rtcConfiguration } : {}),
        ...(options.iceServers ? { iceServers: options.iceServers } : {}),
      });
      this.peer = peer;
      this.setupPeer(peer, options);
    } catch (error) {
      this.emitError(toError(error));
      this.scheduleReconnect('peer');
    }
  }

  private clearReconnectTimer(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  // Mesh logic fully moved to FullMeshStrategy.

  private publishRoster(): void {
    if (!this.isHost() || !this.transportOptions) return;
    this.members = [
      { userId: this.transportOptions.userId, peerId: this.ownPeerId, eligible: this.migrationMode !== 'disabled' },
      ...[...this.connections].map(([userId, connection]) => {
        const known = this.topology === 'full-mesh'
          ? this.members.find((member) => member.peerId === connection.peerId)
          : undefined;
        return {
          userId,
          peerId: connection.peerId,
          eligible: known ? known.eligible !== false
            : !isRecord(connection.metadata) || connection.metadata.hostMigrationMode !== 'disabled',
        };
      }),
    ];
    const packet = {
      type: 'roster',
      topology: this.topology,
      term: this.roomTerm,
      host: this.getHost(),
      members: this.members,
    };
    for (const connection of this.connections.values()) {
      if (connection.open) connection.send(packet);
    }
  }

  private scheduleElection(): void {
    if (this.manuallyDisconnected || !this.peer || this.migrationTimer) return;
    if (!this.migrationEvent && this.migrationMode !== 'auto') return;
    if (!this.members.some((member) => member.peerId === this.ownPeerId)) return;
    this.migrationTimer = setTimeout(() => {
      this.migrationTimer = null;
      if (this.manuallyDisconnected || !this.peer || this.isHost()) return;
      if (this.connected && !this.migrationEvent && !this.awaitingHostConfirmation) return;
      if (this.migrationMode !== 'auto') {
        this.emitError(new Error('RTC manual handoff did not complete before its deadline.'));
        this.scheduleReconnect('client');
        return;
      }
      this.failedCandidates.add(this.hostPeerId);
      const candidates = this.members
        .filter((member) => member.eligible !== false && !this.failedCandidates.has(member.peerId))
        .sort((left, right) => left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0);
      const candidate = candidates[0];
      if (!candidate) {
        this.emitError(new Error('RTC host migration failed: no reachable candidates remain.'));
        this.migrationEvent = null;
        this.scheduleReconnect('client');
        return;
      }
      this.adoptHost(candidate, this.roomTerm + 1, 'automatic');
    }, this.migrationTimeoutMs);
  }

  private adoptHost(target: RoomMember, term: number, reason: 'manual' | 'automatic'): void {
    if (!this.peer || !this.transportOptions || this.manuallyDisconnected) return;
    const previousHostId = this.hostUserId;
    this.clearReconnectTimer();
    this.clearMigrationTimer();
    this.reconnectMode = null;
    const oldClient = this.clientConnection;
    this.clientConnection = null;
    if (this.topology === 'star') {
      for (const connection of this.connections.values()) this.retiredConnections.add(connection);
    }
    this.connections.clear();
    this.hostPeerId = target.peerId;
    this.hostUserId = target.userId;
    this.roomTerm = term;
    this.connected = false;
    this.awaitingHostConfirmation = true;
    this.role = target.peerId === this.ownPeerId ? 'host' : 'client';
    this.migrationEvent = { ...target, previousHostId, reason, migrating: true };
    this.events.emit('hostChanged', this.migrationEvent);
    if (this.topology === 'star') oldClient?.close();
    else if (this.strategy instanceof FullMeshStrategy) {
      const meshConns = this.strategy.getConnections();
      this.clientConnection = meshConns.get(target.peerId) ?? null;
      if (this.isHost()) {
        for (const [peerId, connection] of meshConns) {
          const userId = [...meshConns.keys()].includes(peerId) ? peerId : undefined;
          // userId mapping lives inside strategy; host re-adopts via connections map already
          if (connection.open) this.connections.set(peerId, connection);
        }
      }
    }
    this.notifyPeersChanged();
    if (this.isHost()) {
      this.connected = true;
      this.completeMigration();
      this.publishRoster();
      this.notifyPeersChanged();
    } else {
      this.connectClient(this.peer, this.transportOptions);
      this.scheduleElection();
    }
  }

  private completeMigration(): void {
    this.clearMigrationTimer();
    this.failedCandidates.clear();
    this.awaitingHostConfirmation = false;
    if (this.clientConnection?.open) this.connected = true;
    const event = this.migrationEvent;
    this.migrationEvent = null;
    if (event) {
      this.events.emit('hostChanged', { ...event, migrating: false });
    }
    for (const connection of this.retiredConnections) connection.close();
    this.retiredConnections.clear();
    this.notifyPeersChanged();
  }

  private clearMigrationTimer(): void {
    if (this.migrationTimer === null) return;
    clearTimeout(this.migrationTimer);
    this.migrationTimer = null;
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    if (this.topology === 'full-mesh' && this.strategy?.startMaintenance) {
      this.strategy.startMaintenance(this.buildTopologyContext());
      return;
    }
    if (this.migrationMode === 'disabled') return;
    this.lastHostActivity = Date.now();
    this.heartbeatTimer = setInterval(() => {
      if (this.manuallyDisconnected) return;
      if (this.isHost()) {
        for (const connection of this.connections.values()) {
          if (connection.open) connection.send({ type: 'heartbeat' });
        }
      } else if (this.connected && this.members.length > 0 &&
          Date.now() - this.lastHostActivity > this.migrationTimeoutMs) {
        this.emitError(new Error('RTC host heartbeat timed out.'));
        this.clientConnection?.close();
      }
    }, Math.max(1, Math.min(2_000, Math.floor(this.migrationTimeoutMs / 3))));
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer === null) return;
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private handlePacket(
    data: unknown,
    role: 'host' | 'client',
    clientUserId?: string,
  ): void {
    if (!isRecord(data) || typeof data.type !== 'string') {
      this.emitError(new Error('Received an invalid RTC packet.'));
      return;
    }

    if (role === 'client' && data.type === 'roster') {
      const host = data.host;
      if (!isHostInfo(host) || host.peerId !== this.hostPeerId ||
          !Number.isSafeInteger(data.term) || typeof data.term !== 'number' ||
          data.term < this.roomTerm || !Array.isArray(data.members) ||
          !data.members.every(isRoomMember) ||
          !data.members.some((member) => member.peerId === host.peerId &&
            member.userId === host.userId) ||
          new Set(data.members.map((member) => member.userId)).size !== data.members.length ||
          new Set(data.members.map((member) => member.peerId)).size !== data.members.length ||
          !data.members.some((member) => member.peerId === this.ownPeerId &&
            member.userId === this.transportOptions?.userId)) {
        this.emitError(new Error('Received an invalid RTC migration roster.'));
        return;
      }
      this.members = data.members;
      this.roomTerm = data.term;
      this.hostUserId = host.userId;
      this.completeMigration();
      return;
    }
    if (role === 'client' && data.type === 'migrate') {
      if (this.migrationMode === 'disabled') return;
      const target = this.members.find((member) => member.userId === data.targetId);
      if (!target || target.eligible === false || target.peerId === this.hostPeerId ||
          typeof data.term !== 'number' || !Number.isSafeInteger(data.term) ||
          data.term <= this.roomTerm) {
        this.emitError(new Error('Received an invalid RTC host handoff.'));
        return;
      }
      this.adoptHost(target, data.term, 'manual');
      return;
    }
    if (role === 'client' && data.type === 'hello' && typeof data.userId === 'string') {
      this.hostUserId = data.userId;
      if (!this.migrationEvent) {
        this.awaitingHostConfirmation = false;
        this.clearMigrationTimer();
        this.connected = true;
      }
      this.notifyPeersChanged();
      return;
    }
    if (data.type !== 'message' || typeof data.event !== 'string') return;

    const senderId = role === 'host' ? clientUserId : this.hostUserId;
    if (!senderId) return;

    if (role === 'host' && clientUserId) {
      const targetsHost = data.targetId === this.hostPeerId || data.targetId === this.hostUserId;
      if (!data.targetId) {
        const packet: WireMessage = {
          type: 'message',
          event: data.event,
          payload: data.payload,
        };
        for (const [peerId, recipient] of this.connections) {
          if (peerId !== clientUserId && recipient.open) {
            recipient.send(packet);
          }
        }
      } else if (!targetsHost) {
        if (typeof data.targetId !== 'string') {
          this.emitError(new Error('RTC targetId must be a string.'));
          return;
        }
        const target = this.connections.get(data.targetId);
        if (!target?.open) {
          this.emitError(new Error(`RTC peer "${data.targetId}" is not connected.`));
          return;
        }
        target.send({
          type: 'message',
          event: data.event,
          payload: data.payload,
        } satisfies WireMessage);
        return;
      }
    }

    this.events.emit('message', { event: data.event, payload: data.payload, senderId });
  }

  private notifyPeersChanged(): void {
    const peers = this.getPeers();
    this.events.emit('peersChanged', peers);
  }

  private emitError(error: Error): void {
    this.events.emit('error', error);
  }
}

function getUserId(metadata: unknown): string | null {
  if (!isRecord(metadata) || typeof metadata.userId !== 'string' || !metadata.userId.trim()) return null;
  return metadata.userId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHostInfo(value: unknown): value is HostInfo {
  return isRecord(value) && typeof value.userId === 'string' && value.userId.length > 0 &&
    typeof value.peerId === 'string' && value.peerId.length > 0;
}

function isRoomMember(value: unknown): value is RoomMember {
  return isHostInfo(value) && (!('eligible' in value) ||
    value.eligible === undefined || typeof value.eligible === 'boolean');
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export { DefaultConnectionStateMachine } from './patterns/ConnectionStateMachine';
export type { ConnectionStateName, ConnectionStateMachine } from './patterns/ConnectionStateMachine';
export { EventBus } from './patterns/EventBus';
export { FullMeshStrategy } from './patterns/FullMeshStrategy';
export { StarStrategy } from './patterns/StarStrategy';
export type { TopologyStrategy, TopologyContext } from './patterns/TopologyStrategy';



