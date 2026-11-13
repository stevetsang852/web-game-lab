import { ErrorCodes, SdkError } from '@web-lab-sdk/core';
import { createOfflineSession } from '../session.js';
import type { IdentityPort, Session } from '../types.js';

/**
 * Null object for a Phase 0 demo that has no auth server.
 * The session is labeled `offline-demo` and cannot be used as a production bearer.
 * It does not pretend the player completed Google, Apple, or Telegram login.
 */
export class OfflineAuth implements IdentityPort {
  readonly id = 'offline' as const;

  async authenticate(input: unknown): Promise<Session> {
    if (input && typeof input === 'object') {
      const record = input as Record<string, unknown>;
      if ('token' in record || 'accountId' in record || 'email' in record) {
        throw new SdkError(
          ErrorCodes.InvalidSession,
          'OfflineAuth does not accept a caller-supplied identity or session.',
        );
      }
    }
    return createOfflineSession();
  }

  async link(_input: unknown): Promise<Session> {
    throw new SdkError(
      ErrorCodes.LinkRejected,
      'An offline demo session cannot link a provider identity. Sign in through the server first.',
    );
  }
}
