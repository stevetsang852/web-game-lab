import { createRtcPeer, type RtcDataConnection, type RtcPeer } from '@game-multi-sdk/core';
import type {
  GameCategory,
  IGameTransport,
  MessageHandler,
  PeersChangedHandler,
  SendOptions,
  TransportErrorHandler,
  TransportOptions,
} from '@game-multi-sdk/core';

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

export class RtcHostTransport implements IGameTransport {
  readonly category: GameCategory = 'RTC_HOST';

  private peer: RtcPeer | null = null;
  private connections = new Map<string, RtcDataConnection>();
  private clientConnection: RtcDataConnection | null = null;
  private hostPeerId = '';
  private hostUserId = '';
  private role: 'host' | 'client' | null = null;
  private connected = false;
  private connecting = false;
  private messageHandlers = new Set<MessageHandler>();
  private peersChangedHandlers = new Set<PeersChangedHandler>();
  private errorHandlers = new Set<TransportErrorHandler>();

  async connect(options: TransportOptions): Promise<void> {
    if (this.peer || this.connecting) {
      throw new Error('RTC transport is already connected or connecting.');
    }

    const role = options.role ?? 'host';
    if (role !== 'host' && role !== 'client') {
      throw new Error(`Unsupported RTC transport role "${String(role)}".`);
    }
    if (!options.roomId.trim() || !options.userId.trim()) {
      throw new Error('RTC roomId and userId must not be empty.');
    }
    const hostPeerId = options.hostPeerId ?? options.roomId;
    if (role === 'client' && !hostPeerId) {
      throw new Error('A host PeerJS ID is required for a client connection.');
    }

    this.connecting = true;
    this.role = role;
    this.hostPeerId = hostPeerId;
    this.hostUserId = role === 'host' ? options.userId : hostPeerId;

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

      try {
        const peer = createRtcPeer({
          ...(role === 'host' ? { id: options.roomId } : {}),
          signalingEndpoint: options.endpoint,
          ...(options.iceServers ? { iceServers: options.iceServers } : {}),
        });
        this.peer = peer;

        peer.onError(fail);
        peer.onOpen(() => {
          if (role === 'host') {
            finish();
            return;
          }

          const connection = peer.connect(hostPeerId, { userId: options.userId });
          this.clientConnection = connection;
          this.listenToConnection(connection, 'client', finish);
        });

        if (role === 'host') {
          peer.onConnection((connection) => {
            const userId = getUserId(connection.metadata);
            if (!userId) {
              this.emitError(new Error('RTC client connection is missing a userId.'));
              connection.close();
              return;
            }

            this.listenToConnection(connection, 'host', () => {
              const existing = this.connections.get(userId);
              if (existing && existing !== connection) {
                this.emitError(new Error(`RTC user "${userId}" is already connected.`));
                connection.close();
                return;
              }
              this.connections.set(userId, connection);
              this.notifyPeersChanged();
              connection.send({ type: 'hello', userId: options.userId } satisfies WireHello);
            }, userId);
          });
        }
      } catch (error) {
        fail(toError(error));
      }
    });
  }

  disconnect(): void {
    const peer = this.peer;
    this.peer = null;
    this.connected = false;
    this.connecting = false;
    this.role = null;

    const connections = [...this.connections.values()];
    if (this.clientConnection) connections.push(this.clientConnection);
    this.connections.clear();
    this.clientConnection = null;
    this.hostUserId = this.hostPeerId;

    for (const connection of new Set(connections)) connection.close();
    peer?.destroy();
    this.notifyPeersChanged();
  }

  send(event: string, payload: unknown, options?: SendOptions): void {
    if (!this.connected) throw new Error('RTC transport is not connected.');
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

  getPeers(): string[] {
    if (!this.connected) return [];
    return this.isHost() ? [...this.connections.keys()] : (this.hostUserId ? [this.hostUserId] : []);
  }

  isHost(): boolean {
    return this.role === 'host';
  }

  private listenToConnection(
    connection: RtcDataConnection,
    role: 'host' | 'client',
    onOpen: () => void,
    clientUserId?: string,
  ): void {
    connection.onOpen(onOpen);
    connection.onData((data) => this.handlePacket(data, role, clientUserId));
    connection.onClose(() => {
      if (role === 'host' && clientUserId) {
        if (this.connections.get(clientUserId) === connection) {
          this.connections.delete(clientUserId);
          this.notifyPeersChanged();
        }
      } else if (this.clientConnection === connection) {
        this.clientConnection = null;
        this.connected = false;
        this.hostUserId = this.hostPeerId;
        this.notifyPeersChanged();
      }
    });
    connection.onError((error) => this.emitError(error));
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

    if (role === 'client' && data.type === 'hello' && typeof data.userId === 'string') {
      this.hostUserId = data.userId;
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
        this.emitError(new Error(`RTC peer "${String(data.targetId)}" is not connected.`));
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
