import type {
  GameCategory,
  IGameTransport,
  MessageHandler,
  SendOptions,
  TransportOptions,
} from '@game-multi-sdk/core';

/**
 * ServerTransport — authoritative WebSocket mode.
 * Suitable for strategy / simulation games that require a central server.
 */
export class ServerTransport implements IGameTransport {
  readonly category: GameCategory = 'SERVER';

  async connect(options: TransportOptions): Promise<void> {
    // TODO: Implement WebSocket connection, auto-reconnect, heartbeat
    console.log('[ServerTransport] connect', options);
  }

  disconnect(): void {
    // TODO: Close socket and cleanup
  }

  send(event: string, payload: unknown, options?: SendOptions): void {
    // TODO: Serialize and send via WebSocket
  }

  onMessage(callback: MessageHandler): () => void {
    // TODO: Register message handler
    return () => undefined;
  }

  getPeers(): string[] {
    return [];
  }

  isHost(): boolean {
    return false; // Server mode has no "host" concept on client
  }
}
