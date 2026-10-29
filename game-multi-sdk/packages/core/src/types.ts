/**
 * Game transport category.
 * - SERVER: Authoritative server mode via WebSocket (e.g. strategy / simulation games)
 * - RTC_HOST: WebRTC star-topology host mode (host = room owner, P2P data channels)
 */
export type GameCategory = 'SERVER' | 'RTC_HOST';

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
  /** Optional WebRTC ICE server configuration (for example, STUN/TURN). */
  iceServers?: RTCIceServer[];
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

  /** Return the list of currently connected peer userIds (excluding self when applicable). */
  getPeers(): string[];

  /** Whether the current user is the host / room owner. */
  isHost(): boolean;
}
