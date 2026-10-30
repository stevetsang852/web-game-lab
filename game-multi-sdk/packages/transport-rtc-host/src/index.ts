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

export class RtcHostTransport implements IGameTransport {
  readonly category: GameCategory = 'RTC_HOST';
  private readonly createPeer?: RtcPeerFactory;

  constructor(createPeer?: RtcPeerFactory) {
    this.createPeer = createPeer;
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
  private meshJoined = false;
  private meshConnections = new Map<string, RtcDataConnection>();
  private meshUsers = new Map<string, string>();
  private meshClaims = new Map<string, string | null>();
  private meshRemoteReady = new Set<string>();
  private meshReadySent = new Set<string>();
  private meshActivity = new Map<string, number>();
  private meshDeadlines = new Map<RtcDataConnection, ReturnType<typeof setTimeout>>();
  private meshRetryTimer: ReturnType<typeof setInterval> | null = null;
  private meshAttempted = new Set<string>();
  private hostChangedHandlers = new Set<HostChangedHandler>();
  private messageHandlers = new Set<MessageHandler>();
  private peersChangedHandlers = new Set<PeersChangedHandler>();
  private errorHandlers = new Set<TransportErrorHandler>();

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
    this.manuallyDisconnected = false;
    this.reconnectEnabled = options.reconnect?.enabled ?? true;
    this.reconnectIntervalMs = reconnectIntervalMs;
    this.transportOptions = options;
    this.topology = topology;
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
    this.clearReconnectTimer();
    this.clearMigrationTimer();
    this.stopHeartbeat();
    this.stopMeshTimers();
    this.meshJoined = false;
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
    connections.push(...this.meshConnections.values());
    this.meshConnections.clear();
    this.meshUsers.clear();
    this.meshClaims.clear();
    this.meshRemoteReady.clear();
    this.meshReadySent.clear();
    this.meshActivity.clear();
    this.meshAttempted.clear();
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
    if (this.topology === 'full-mesh') {
      if (options?.targetId) {
        const entry = [...this.meshUsers].find(([peerId, userId]) =>
          userId === options.targetId || peerId === options.targetId);
        const connection = entry && this.meshConnections.get(entry[0]);
        if (!connection?.open || !entry || !this.meshRemoteReady.has(entry[0])) {
          throw new Error(`RTC peer "${options.targetId}" is not connected.`);
        }
        connection.send(packet);
      } else {
        const missing = this.members.filter((member) => member.peerId !== this.ownPeerId &&
          (!this.meshConnections.get(member.peerId)?.open || !this.meshRemoteReady.has(member.peerId)));
        if (missing.length) {
          this.emitError(new Error(`RTC mesh broadcast cannot reach: ${missing.map((member) => member.userId).join(', ')}.`));
        }
        for (const [peerId, connection] of this.meshConnections) {
          if (connection.open && this.meshUsers.has(peerId) && this.meshRemoteReady.has(peerId)) connection.send(packet);
        }
      }
      return;
    }
    if (this.isHost()) {
      if (options?.targetId) {
        const connection = this.connections.get(options.targetId);
        if (!connection?.open) {
          throw new Error(`RTC peer "${options.targetId}" is not connected.`);
        }
        connection.send(packet);
        return;
      }

      for (const connection of this.connections.values()) {
        if (connection.open) connection.send(packet);
      }
      return;
    }

    if (options?.targetId && options.targetId !== this.hostPeerId && options.targetId !== this.hostUserId) {
      throw new Error(`RTC peer "${options.targetId}" is not connected.`);
    }
    if (!this.clientConnection?.open) {
      throw new Error('RTC host connection is not open.');
    }
    this.clientConnection.send(packet);
  }

  onMessage(callback: MessageHandler): () => void {
    this.messageHandlers.add(callback);
    return () => this.messageHandlers.delete(callback);
  }

  onPeersChanged(callback: PeersChangedHandler): () => void {
    this.peersChangedHandlers.add(callback);
    return () => this.peersChangedHandlers.delete(callback);
  }

  onError(callback: TransportErrorHandler): () => void {
    this.errorHandlers.add(callback);
    return () => this.errorHandlers.delete(callback);
  }

  getHost(): HostInfo | null {
    if (!this.transportOptions) return null;
    return { userId: this.hostUserId, peerId: this.hostPeerId };
  }

  onHostChanged(callback: HostChangedHandler): () => void {
    this.hostChangedHandlers.add(callback);
    return () => this.hostChangedHandlers.delete(callback);
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
    if (this.topology === 'full-mesh') {
      if (!this.meshJoined) return [];
      return [...this.meshUsers]
        .filter(([peerId]) => this.meshConnections.get(peerId)?.open && this.meshRemoteReady.has(peerId))
        .map(([, userId]) => userId);
    }
    if (!this.connected) return [];
    return this.isHost() ? [...this.connections.keys()] : (this.hostUserId ? [this.hostUserId] : []);
  }

  isHost(): boolean {
    return this.role === 'host';
  }

  isConnected(): boolean {
    return this.topology === 'full-mesh' ? this.meshJoined && this.peer !== null : this.connected;
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
      if (this.isHost()) {
        this.hostPeerId = peerId;
        this.hostUserId = options.userId;
        this.connected = true;
        if (this.topology === 'full-mesh') {
          this.meshJoined = true;
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
        if (this.topology === 'full-mesh') {
          this.acceptMeshConnection(peer, connection);
          return;
        }
        if (!this.isHost()) {
          this.emitError(new Error('RTC incoming connection rejected: this peer is not the host.'));
          connection.close();
          return;
        }
        const userId = getUserId(connection.metadata);
        if (!userId || userId === options.userId) {
          this.emitError(new Error('RTC client connection requires a unique non-host userId.'));
          connection.close();
          return;
        }

        this.listenToConnection(connection, 'host', () => {
          if (!this.isHost() || this.peer !== peer) {
            connection.close();
            return;
          }
          const existing = this.connections.get(userId);
          if (existing && existing !== connection) {
            this.emitError(new Error(`RTC user "${userId}" is already connected.`));
            connection.close();
            return;
          }
          this.connections.set(userId, connection);
          this.notifyPeersChanged();
          connection.send({ type: 'hello', userId: options.userId } satisfies WireHello);
          this.publishRoster();
        }, userId);
      });
  }

  private connectClient(
    peer: RtcPeer,
    options: TransportOptions,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    if (this.topology === 'full-mesh') {
      this.connectMeshCoordinator(peer, onReady, onFailure);
      return;
    }
    const hostPeerId = this.hostPeerId;
    try {
      const connection = peer.connect(hostPeerId, {
        userId: options.userId,
        ...(this.migrationMode === 'disabled' ? { hostMigrationMode: 'disabled' } : {}),
      });
      this.clientConnection = connection;
      this.listenToConnection(connection, 'client', () => {
        if (this.clientConnection !== connection || this.peer !== peer) return;
        this.connected = !this.migrationEvent;
        this.lastHostActivity = Date.now();
        this.connecting = false;
        this.reconnectMode = null;
        this.clearReconnectTimer();
        onReady?.();
        this.notifyPeersChanged();
        // The roster confirms the elected host identity before migration completes.
        if (!this.migrationEvent && !this.awaitingHostConfirmation) this.clearMigrationTimer();
      }, undefined, onFailure);
    } catch (error) {
      const connectionError = toError(error);
      if (this.connecting && onReady) {
        onFailure?.(connectionError);
        return;
      }
      this.emitError(connectionError);
      this.scheduleReconnect('client');
    }
  }

  private handlePeerLost(peer: RtcPeer): void {
    if (this.peer !== peer) return;
    this.peer = null;
    this.stopHeartbeat();
    this.stopMeshTimers();
    this.meshJoined = false;
    this.connected = false;
    if (this.role === 'client') this.awaitingHostConfirmation = true;
    this.connecting = false;
    const connections = [...this.connections.values()];
    connections.push(...this.meshConnections.values());
    this.meshConnections.clear();
    this.meshUsers.clear();
    this.meshClaims.clear();
    this.meshRemoteReady.clear();
    this.meshReadySent.clear();
    this.meshActivity.clear();
    this.meshAttempted.clear();
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

  private meshMetadata(purpose: 'join' | 'mesh'): Record<string, unknown> {
    const options = this.transportOptions;
    if (!options) throw new Error('RTC mesh transport has no active connection options.');
    return {
      userId: options.userId,
      roomId: options.roomId,
      topology: 'full-mesh',
      purpose,
      hostMigrationMode: this.migrationMode,
    };
  }

  private acceptMeshConnection(peer: RtcPeer, connection: RtcDataConnection): void {
    const metadata = connection.metadata;
    const userId = getUserId(metadata);
    if (!isRecord(metadata) || metadata.roomId !== this.transportOptions?.roomId ||
        !userId || userId === this.transportOptions?.userId ||
        (metadata.purpose !== 'mesh' && metadata.purpose !== 'join') ||
        (metadata.purpose === 'join' && !this.isHost())) {
      this.emitError(new Error('RTC mesh connection has invalid room, identity, or coordinator metadata.'));
      connection.close();
      return;
    }
    const member = this.members.find((entry) => entry.peerId === connection.peerId);
    if (member && member.userId !== userId) {
      this.emitError(new Error('RTC mesh peer identity does not match the room roster.'));
      connection.close();
      return;
    }
    if (metadata.purpose === 'join' &&
        this.members.some((entry) => entry.userId === userId && entry.peerId !== connection.peerId)) {
      this.emitError(new Error(`RTC user "${userId}" is already connected.`));
      connection.close();
      return;
    }
    this.trackMeshConnection(peer, connection, userId, metadata.purpose === 'join');
  }

  private connectMeshCoordinator(
    peer: RtcPeer,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    const existing = this.meshConnections.get(this.hostPeerId);
    if (existing) {
      this.clientConnection = existing;
      if (existing.open) existing.send({ type: 'roster-request' });
      return;
    }
    try {
      const connection = peer.connect(this.hostPeerId, this.meshMetadata('join'));
      this.clientConnection = connection;
      const member = this.members.find((entry) => entry.peerId === this.hostPeerId);
      this.trackMeshConnection(peer, connection, member?.userId ?? null, false, onReady, onFailure);
    } catch (error) {
      const failure = toError(error);
      if (this.connecting && onFailure) onFailure(failure);
      else {
        this.emitError(failure);
        this.scheduleReconnect('client');
      }
    }
  }

  private trackMeshConnection(
    peer: RtcPeer,
    connection: RtcDataConnection,
    claimedUserId: string | null,
    joining: boolean,
    onReady?: () => void,
    onFailure?: (error: Error) => void,
  ): void {
    const peerId = connection.peerId;
    if (this.meshConnections.has(peerId)) {
      this.emitError(new Error(`RTC mesh already has a connection to "${peerId}".`));
      connection.close();
      return;
    }
    this.meshConnections.set(peerId, connection);
    this.meshClaims.set(peerId, claimedUserId);
    const current = () => this.peer === peer && this.meshConnections.get(peerId) === connection;
    const closed = () => {
      this.clearMeshDeadline(connection);
      if (!current()) return;
      const userId = this.meshUsers.get(peerId);
      this.meshConnections.delete(peerId);
      this.meshUsers.delete(peerId);
      this.meshClaims.delete(peerId);
      this.meshRemoteReady.delete(peerId);
      this.meshReadySent.delete(peerId);
      this.meshActivity.delete(peerId);
      if (this.manuallyDisconnected) return;
      if (this.connecting && this.clientConnection === connection && onFailure) {
        onFailure(new Error('RTC mesh coordinator connection closed before admission.'));
        return;
      }
      if (this.isHost() && userId && this.connections.get(userId) === connection) {
        this.connections.delete(userId);
        this.publishRoster();
      } else if (this.clientConnection === connection) {
        this.clientConnection = null;
        this.connected = false;
        this.awaitingHostConfirmation = true;
        this.scheduleReconnect('client');
        this.scheduleElection();
      }
      this.notifyPeersChanged();
    };
    connection.onClose(closed);
    connection.onError((error) => {
      if (!current()) return;
      this.emitError(error);
      closed();
      connection.close();
    });
    connection.onOpen(() => {
      if (!current()) {
        connection.close();
        return;
      }
      this.meshActivity.set(peerId, Date.now());
      const member = this.members.find((entry) => entry.peerId === peerId);
      if (claimedUserId && ((joining && this.isHost()) || member?.userId === claimedUserId)) {
        this.meshUsers.set(peerId, claimedUserId);
      }
      const userId = this.meshUsers.get(peerId);
      if (this.isHost() && userId) {
        const existing = this.connections.get(userId);
        if (existing && existing !== connection) {
          this.emitError(new Error(`RTC user "${userId}" is already connected.`));
          closed();
          connection.close();
          return;
        }
        this.connections.set(userId, connection);
        connection.send({ type: 'hello', userId: this.hostUserId, topology: 'full-mesh' });
        this.publishRoster();
      }
      this.confirmMeshReady(peerId, connection);
      this.notifyPeersChanged();
    });
    connection.onData((data) => {
      if (!current()) return;
      this.meshActivity.set(peerId, Date.now());
      if (!isRecord(data) || typeof data.type !== 'string') {
        this.emitError(new Error('Received an invalid RTC mesh packet.'));
        return;
      }
      if (data.type === 'mesh-ready') {
        this.meshRemoteReady.add(peerId);
        this.confirmMeshReady(peerId, connection);
        this.notifyPeersChanged();
        return;
      }
      const coordinator = !this.isHost() && peerId === this.hostPeerId;
      if (coordinator && (data.type === 'hello' || data.type === 'roster')) {
        if (data.topology !== 'full-mesh') {
          const error = new Error('RTC topology mismatch: expected a full-mesh coordinator.');
          if (this.connecting && onFailure) onFailure(error);
          else this.emitError(error);
          closed();
          connection.close();
          return;
        }
        this.handlePacket(data, 'client');
        if (data.type === 'roster' && this.members === data.members) {
          this.meshJoined = true;
          this.connected = true;
          this.connecting = false;
          this.clearReconnectTimer();
          this.reconnectMode = null;
          this.reconcileMesh();
          onReady?.();
          this.notifyPeersChanged();
        }
        return;
      }
      const senderId = this.meshUsers.get(peerId);
      if (!senderId) {
        if (data.type !== 'heartbeat') this.emitError(new Error('RTC mesh packet rejected before roster admission.'));
        return;
      }
      if (coordinator && data.type === 'migrate') {
        this.handlePacket(data, 'client');
      } else if (this.isHost() && data.type === 'roster-request') {
        this.publishRoster();
      } else if (data.type === 'message' && typeof data.event === 'string') {
        if (data.targetId !== undefined && data.targetId !== this.transportOptions?.userId &&
            data.targetId !== this.ownPeerId) {
          this.emitError(new Error('RTC mesh message is addressed to another participant.'));
          return;
        }
        for (const handler of this.messageHandlers) handler(data.event, data.payload, senderId);
      } else if (data.type === 'roster' || data.type === 'migrate' || data.type === 'hello') {
        this.emitError(new Error('RTC mesh control packet is not from the current coordinator.'));
      }
    });
    this.meshDeadlines.set(connection, setTimeout(() => {
      this.meshDeadlines.delete(connection);
      if (!current()) return;
      this.emitError(new Error(`RTC mesh connection to "${peerId}" timed out before admission.`));
      closed();
      connection.close();
    }, this.migrationTimeoutMs));
  }

  private reconcileMesh(): void {
    const peer = this.peer;
    if (!peer || this.manuallyDisconnected) return;
    for (const member of this.members) {
      if (member.peerId === this.ownPeerId) continue;
      const connection = this.meshConnections.get(member.peerId);
      if (connection) {
        const claim = this.meshClaims.get(member.peerId);
        if (claim !== null && claim !== member.userId) {
          this.emitError(new Error('RTC mesh peer identity does not match the room roster.'));
          connection.close();
        } else if (connection.open) {
          this.meshUsers.set(member.peerId, member.userId);
          this.confirmMeshReady(member.peerId, connection);
        }
        continue;
      }
      // One deterministic dialer per pair prevents duplicate channels.
      if (this.isHost() || member.peerId === this.hostPeerId || this.ownPeerId > member.peerId ||
          (!this.reconnectEnabled && this.meshAttempted.has(member.peerId))) continue;
      this.meshAttempted.add(member.peerId);
      try {
        this.trackMeshConnection(peer, peer.connect(member.peerId, this.meshMetadata('mesh')), member.userId, false);
      } catch (error) {
        this.emitError(toError(error));
      }
    }
  }

  private clearMeshDeadline(connection: RtcDataConnection): void {
    const timer = this.meshDeadlines.get(connection);
    if (timer !== undefined) clearTimeout(timer);
    this.meshDeadlines.delete(connection);
  }

  private confirmMeshReady(peerId: string, connection: RtcDataConnection): void {
    if (!this.meshJoined || !this.meshUsers.has(peerId) || !connection.open) return;
    if (!this.meshReadySent.has(peerId)) {
      this.meshReadySent.add(peerId);
      connection.send({ type: 'mesh-ready' });
    }
    if (this.meshRemoteReady.has(peerId)) this.clearMeshDeadline(connection);
  }

  private startMeshMaintenance(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [peerId, connection] of this.meshConnections) {
        if (!connection.open) continue;
        if (Date.now() - (this.meshActivity.get(peerId) ?? Date.now()) > this.migrationTimeoutMs) {
          this.emitError(new Error(`RTC mesh peer "${peerId}" heartbeat timed out.`));
          connection.close();
          continue;
        }
        connection.send({ type: 'heartbeat' });
        if (peerId === this.hostPeerId && this.awaitingHostConfirmation) {
          connection.send({ type: 'roster-request' });
        }
      }
    }, Math.max(1, Math.min(2_000, Math.floor(this.migrationTimeoutMs / 3))));
    if (this.meshRetryTimer !== null) clearInterval(this.meshRetryTimer);
    if (this.reconnectEnabled) {
      this.meshRetryTimer = setInterval(() => this.reconcileMesh(), this.reconnectIntervalMs);
    }
    this.reconcileMesh();
  }

  private stopMeshTimers(): void {
    for (const timer of this.meshDeadlines.values()) clearTimeout(timer);
    this.meshDeadlines.clear();
    if (this.meshRetryTimer !== null) clearInterval(this.meshRetryTimer);
    this.meshRetryTimer = null;
  }

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
    for (const handler of this.hostChangedHandlers) handler(this.migrationEvent);
    if (this.topology === 'star') oldClient?.close();
    else {
      this.clientConnection = this.meshConnections.get(target.peerId) ?? null;
      if (this.isHost()) {
        for (const [peerId, connection] of this.meshConnections) {
          const userId = this.meshUsers.get(peerId);
          if (userId && connection.open) this.connections.set(userId, connection);
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
      for (const handler of this.hostChangedHandlers) handler({ ...event, migrating: false });
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
    if (this.topology === 'full-mesh') {
      this.startMeshMaintenance();
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

    for (const handler of this.messageHandlers) {
      handler(data.event, data.payload, senderId);
    }
  }

  private notifyPeersChanged(): void {
    const peers = this.getPeers();
    for (const handler of this.peersChangedHandlers) handler(peers);
  }

  private emitError(error: Error): void {
    for (const handler of this.errorHandlers) handler(error);
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
