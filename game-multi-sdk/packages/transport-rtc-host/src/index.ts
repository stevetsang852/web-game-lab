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

  // ... rest of file truncated for this attempt - need full content
}