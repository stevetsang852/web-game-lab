/**
 * Game transport category.
 * - SERVER: Authoritative server mode via WebSocket (e.g. strategy / simulation games)
 * - RTC_HOST: WebRTC full-mesh or star topology with a room coordinator
 */
export type GameCategory = 'SERVER' | 'RTC_HOST';
export type RtcTopology = 'full-mesh' | 'star';

/**
 * Connection options required by any transport implementation.
 */
export interface TransportOptions {
  /** Unique room / session identifier */
  roomId: string;
  /** Current user's unique identifier */
  userId: string;
  /** Signaling or WebSocket endpoint URL */
  endpoint: string;
  /** RTC_HOST role. Defaults to "host" for backwards compatibility. */
  role?: 'host' | 'client';
  /** Host's PeerJS ID when connecting as a client. Defaults to roomId. */
  hostPeerId?: string;
  /** RTC topology. Defaults to full-mesh; star routes client traffic through the host. */
  topology?: RtcTopology;
  /** Full WebRTC configuration, including TURN credentials and relay-only policy. */
  rtcConfiguration?: RTCConfiguration;
  /** STUN/TURN shorthand. rtcConfiguration.iceServers takes precedence when provided. */
  iceServers?: RTCIceServer[];
  /** Automatic reconnect policy. Enabled by default with a 5-second retry interval. */
  reconnect?: {
    enabled?: boolean;
    intervalMs?: number;
  };
  /** RTC host election policy. Defaults to auto; manual only permits explicit handoff. */
  hostMigration?: {
    mode?: 'auto' | 'manual' | 'disabled';
    /** Delay before election, and deadline for each candidate connection. Defaults to 5000. */
    timeoutMs?: number;
  };
}

/**
 * Optional parameters when sending a message.
 */
export interface SendOptions {
  /** Prefer reliable (ordered) delivery. Defaults to true for most implementations. */
  reliable?: boolean;
  /** Target a specific peer. Omit to broadcast. */
  targetId?: string;
}

export type MessageHandler = (event: string, payload: unknown, senderId: string) => void;
export type PeersChangedHandler = (peerIds: string[]) => void;
export type TransportErrorHandler = (error: Error) => void;
export interface HostInfo {
  userId: string;
  peerId: string;
}
export interface HostChangedEvent extends HostInfo {
  previousHostId: string;
  reason: 'manual' | 'automatic';
  /** True during host/coordinator transition; false when local coordination is ready. */
  migrating: boolean;
}
export type HostChangedHandler = (event: HostChangedEvent) => void;

/**
 * Unified transport contract that all communication drivers must implement.
 * Upper layers (React bindings, game logic) only depend on this interface.
 */
export interface IGameTransport {
  /** Which category this transport belongs to */
  readonly category: GameCategory;

  /**
   * Establish connection to the room.
   * Resolves when the transport is ready to send/receive.
   */
  connect(options: TransportOptions): Promise<void>;

  /** Gracefully close all connections and clean up resources. */
  disconnect(): void;

  /**
   * Send an event with payload.
   * @param event Event name (e.g. "player-move", "chat")
   * @param payload Arbitrary serializable data
   * @param options Optional delivery hints
   */
  send(event: string, payload: unknown, options?: SendOptions): void;

  /**
   * Register a callback for incoming messages.
   * The callback receives the event name, payload, and the sender's userId.
   */
  onMessage(callback: MessageHandler): () => void;

  /** Subscribe to changes in the connected peer list. */
  onPeersChanged?(callback: PeersChangedHandler): () => void;

  /** Subscribe to transport errors, including errors raised after connect resolves. */
  onError?(callback: TransportErrorHandler): () => void;

  /** Request a handoff to a connected userId. Only the current host may call this. */
  transferHost?(targetId: string): void;
  /** Current elected host address, suitable for application-level room discovery. */
  getHost?(): HostInfo | null;
  onHostChanged?(callback: HostChangedHandler): () => void;
  /** Local session readiness. Mesh can remain ready while its coordinator migrates. */
  isConnected?(): boolean;

  /** Return the list of currently connected peer userIds (excluding self when applicable). */
  getPeers(): string[];

  /** Whether the current user is the host (mesh membership coordinator). */
  isHost(): boolean;
}
