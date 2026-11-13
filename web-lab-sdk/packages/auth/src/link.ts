import { ErrorCodes, SdkError } from '@web-lab-sdk/core';
import { isBareEmail, readAssertion } from './input.js';
import { isIssuedServerSession } from './session.js';
import type { Session } from './types.js';

const EMAIL_ONLY_MESSAGE =
  'Refusing to attach a login to an existing account by email alone. Linking needs an authenticated server session or verified proof from both identities.';

export type LinkProviderId = 'telegram' | 'google' | 'apple';

export interface LinkExchange {
  readonly provider: LinkProviderId;
  readonly assertion: string;
  readonly mode: 'session' | 'dual-proof';
  readonly session?: Session;
  readonly existingIdentityProof?: string;
}

function asRecord(input: unknown): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null;
  return input as Record<string, unknown>;
}

/**
 * Email is never an account join key. A payload that carries `email` without a
 * server session or dual proof is rejected before any network call.
 */
export function isEmailOnlyAttach(input: unknown): boolean {
  const record = asRecord(input);
  if (!record || !isBareEmail(record.email)) return false;
  if (isIssuedServerSession(record.session)) return false;
  const existing = record.existingIdentityProof;
  const assertion = readAssertion(record, typeof record.provider === 'string' ? record.provider : undefined);
  if (typeof existing === 'string' && existing.trim() && assertion && !isBareEmail(existing) && !isBareEmail(assertion)) {
    return false;
  }
  return true;
}

export function assertCanLink(input: unknown): void {
  if (isEmailOnlyAttach(input)) {
    throw new SdkError(ErrorCodes.EmailOnlyLinkForbidden, EMAIL_ONLY_MESSAGE);
  }
}

/**
 * The only link entry. There is no email-matching method.
 * `currentSession` lets a signed-in caller pass `{ provider, assertion }`
 * without repeating the session, but a raw IdP login still does not attach.
 */
export function parseLinkRequest(input: unknown, currentSession: Session | null): LinkExchange {
  assertCanLink(input);
  const record = asRecord(input);
  if (!record) {
    throw new SdkError(ErrorCodes.LinkRejected, 'Linking requires a provider assertion and proof of the existing account.');
  }
  const provider = record.provider;
  if (provider !== 'telegram' && provider !== 'google' && provider !== 'apple') {
    throw new SdkError(ErrorCodes.LinkRejected, 'Link provider must be telegram, google, or apple.');
  }
  const assertion = readAssertion(record, provider);
  if (!assertion) {
    throw new SdkError(ErrorCodes.LinkRejected, 'Linking requires an identity assertion. An email address is not accepted.');
  }
  if (isBareEmail(assertion)) {
    throw new SdkError(ErrorCodes.EmailOnlyLinkForbidden, EMAIL_ONLY_MESSAGE);
  }
  const dual = typeof record.existingIdentityProof === 'string' ? record.existingIdentityProof.trim() : '';
  if (dual) {
    if (isBareEmail(dual)) {
      throw new SdkError(ErrorCodes.EmailOnlyLinkForbidden, EMAIL_ONLY_MESSAGE);
    }
    return {
      provider,
      assertion,
      mode: 'dual-proof',
      existingIdentityProof: dual,
    };
  }
  if (record.session != null && !isIssuedServerSession(record.session)) {
    throw new SdkError(ErrorCodes.LinkRejected, 'The supplied session is not a server-issued session.');
  }
  const supplied = isIssuedServerSession(record.session) ? record.session : null;
  if (supplied && currentSession && supplied.accountId !== currentSession.accountId) {
    throw new SdkError(
      ErrorCodes.LinkRejected,
      'Refusing to link with a session for a different account than the active client session.',
    );
  }
  const session = supplied ?? (currentSession && isIssuedServerSession(currentSession) ? currentSession : null);
  if (!session) {
    throw new SdkError(
      ErrorCodes.LinkRejected,
      'Linking requires an authenticated server session or verified proof from both sides.',
    );
  }
  if (typeof record.accountId === 'string' && record.accountId !== session.accountId) {
    throw new SdkError(ErrorCodes.LinkRejected, 'Refusing to retarget a link onto a different accountId.');
  }
  return { provider, assertion, mode: 'session', session };
}
