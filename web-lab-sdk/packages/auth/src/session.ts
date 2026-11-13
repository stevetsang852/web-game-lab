import { ErrorCodes, SdkError } from '@web-lab-sdk/core';
import { isBareEmail } from './input.js';
import type { IdentityProviderId, LinkedIdentity, Session, SessionOrigin } from './types.js';

/** Prefix that a production API can reject without parsing a real credential. */
export const OFFLINE_DEMO_TOKEN_PREFIX = 'offline-demo.';

/** Account ids minted by OfflineAuth. They are not server user ids. */
export const OFFLINE_DEMO_ACCOUNT_PREFIX = 'offline-demo:';

const issuedSessions = new WeakSet<object>();

const PROVIDERS = new Set<IdentityProviderId>(['telegram', 'google', 'apple', 'offline']);

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SdkError(ErrorCodes.InvalidSession, `Server session is missing ${field}.`);
  }
  return value.trim();
}

function parseIdentities(value: unknown): readonly LinkedIdentity[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SdkError(ErrorCodes.InvalidSession, 'Session requires at least one linked identity.');
  }
  const identities = value.map((item) => {
    if (!item || typeof item !== 'object') {
      throw new SdkError(ErrorCodes.InvalidSession, 'Session identity is malformed.');
    }
    const record = item as Record<string, unknown>;
    const provider = record.provider;
    const subject = record.subject;
    if (typeof provider !== 'string' || !PROVIDERS.has(provider as IdentityProviderId)) {
      throw new SdkError(ErrorCodes.InvalidSession, 'Session identity provider is not recognized.');
    }
    if (typeof subject !== 'string' || subject.trim() === '' || isBareEmail(subject)) {
      throw new SdkError(
        ErrorCodes.InvalidSession,
        'Identity subject must be the provider subject, not an email address.',
      );
    }
    return Object.freeze({
      provider: provider as IdentityProviderId,
      subject: subject.trim(),
    });
  });
  return Object.freeze(identities);
}

function brand(session: Session): Session {
  const frozen = Object.freeze(session);
  issuedSessions.add(frozen);
  return frozen;
}

/**
 * Accept a session only after the auth server returns it.
 * The browser package never verifies Telegram HMAC and never mints this object itself.
 */
export function parseServerSession(payload: unknown, requiredProvider?: IdentityProviderId): Session {
  if (!payload || typeof payload !== 'object') {
    throw new SdkError(ErrorCodes.InvalidSession, 'Auth endpoint did not return a session object.');
  }
  const record = payload as Record<string, unknown>;
  const accountId = requireText(record.accountId, 'accountId');
  const token = requireText(record.token, 'token');
  const expiresAt = requireText(record.expiresAt, 'expiresAt');
  if (Number.isNaN(Date.parse(expiresAt))) {
    throw new SdkError(ErrorCodes.InvalidSession, 'Session expiresAt is not a timestamp.');
  }
  if (isBareEmail(accountId)) {
    throw new SdkError(ErrorCodes.EmailOnlyLinkForbidden, 'accountId cannot be an email address.');
  }
  if (
    accountId.startsWith(OFFLINE_DEMO_ACCOUNT_PREFIX) ||
    token.startsWith(OFFLINE_DEMO_TOKEN_PREFIX)
  ) {
    throw new SdkError(ErrorCodes.OfflineDemoRejected, 'Server auth returned an offline demo session.');
  }
  if (record.origin != null && record.origin !== 'server') {
    throw new SdkError(ErrorCodes.InvalidSession, 'A server-issued session must use origin "server".');
  }
  const identities = parseIdentities(record.identities);
  if (identities.some((identity) => identity.provider === 'offline')) {
    throw new SdkError(ErrorCodes.InvalidSession, 'A server session cannot carry the offline identity.');
  }
  if (requiredProvider && !identities.some((identity) => identity.provider === requiredProvider)) {
    throw new SdkError(ErrorCodes.InvalidSession, `Server session is missing the ${requiredProvider} identity.`);
  }
  return brand({
    accountId,
    token,
    expiresAt,
    identities,
    origin: 'server',
  });
}

/** Local Phase 0 session. The token is not a bearer a production API should accept. */
export function createOfflineSession(): Session {
  const id = crypto.randomUUID();
  return brand({
    accountId: `${OFFLINE_DEMO_ACCOUNT_PREFIX}${id}`,
    token: `${OFFLINE_DEMO_TOKEN_PREFIX}${id}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    identities: Object.freeze([Object.freeze({ provider: 'offline', subject: 'local-demo' })]),
    origin: 'offline-demo',
  });
}

export function isIssuedSession(value: unknown): value is Session {
  return !!value && typeof value === 'object' && issuedSessions.has(value);
}

export function isIssuedServerSession(value: unknown): value is Session {
  return isIssuedSession(value) && value.origin === 'server';
}

export function assertIssuedSession(session: Session): void {
  if (!isIssuedSession(session)) {
    throw new SdkError(
      ErrorCodes.InvalidSession,
      'Refusing a session this client did not receive from the server or from OfflineAuth.',
    );
  }
  assertOriginLabel(session.origin, session);
}

function assertOriginLabel(origin: SessionOrigin, session: Session): void {
  const offlineShaped = session.token.startsWith(OFFLINE_DEMO_TOKEN_PREFIX)
    || session.accountId.startsWith(OFFLINE_DEMO_ACCOUNT_PREFIX);
  if (origin === 'offline-demo') {
    if (!offlineShaped || session.identities.some((identity) => identity.provider !== 'offline')) {
      throw new SdkError(ErrorCodes.OfflineDemoRejected, 'Offline demo sessions must be visibly labeled.');
    }
    return;
  }
  if (origin !== 'server' || offlineShaped) {
    throw new SdkError(ErrorCodes.OfflineDemoRejected, 'A server session cannot use an offline demo token.');
  }
}
