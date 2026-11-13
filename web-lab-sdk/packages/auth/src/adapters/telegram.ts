import { ErrorCodes, SdkError } from '@web-lab-sdk/core';
import { exchangeWithServer, linkWithServer, readServerOptions, type ServerBackedAdapterOptions } from '../server.js';
import type { IdentityPort, Session } from '../types.js';

/**
 * Telegram Mini App adapter.
 * The client collects `initData` and POSTs it. The server verifies it and is the
 * trust source. This package does not check HMAC and does not embed a bot token.
 */
export class TelegramIdentityAdapter implements IdentityPort {
  readonly id = 'telegram' as const;
  private readonly authEndpoint?: string;
  private readonly fetchImpl: ServerBackedAdapterOptions['fetchImpl'];

  constructor(options: ServerBackedAdapterOptions = {}) {
    const stored = readServerOptions(options);
    this.authEndpoint = stored.authEndpoint;
    this.fetchImpl = stored.fetchImpl;
  }

  authenticate(input: unknown): Promise<Session> {
    const initData = readInitData(input);
    return exchangeWithServer({
      provider: 'telegram',
      endpoint: this.authEndpoint,
      fetchImpl: this.fetchImpl,
      body: { provider: 'telegram', initData },
      requiredProvider: 'telegram',
    });
  }

  link(input: unknown): Promise<Session> {
    return linkWithServer('telegram', this.authEndpoint, this.fetchImpl, input);
  }
}

function readInitData(input: unknown): string {
  if (typeof input === 'string' && input.trim()) return input.trim();
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    if ('accountId' in record && 'token' in record) {
      throw new SdkError(ErrorCodes.InvalidSession, 'Pass Telegram initData, not a client-built session.');
    }
    if (typeof record.initData === 'string' && record.initData.trim()) return record.initData.trim();
  }
  throw new SdkError(ErrorCodes.InvalidArgument, 'Telegram authenticate requires initData.');
}
