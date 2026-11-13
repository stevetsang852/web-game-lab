import { ErrorCodes, SdkError, rejectClientSecrets } from '@web-lab-sdk/core';
import { authorizationHeader, type FetchLike } from './authorized-fetch.js';
import { parseLinkRequest, type LinkExchange } from './link.js';
import { parseServerSession } from './session.js';
import type { IdentityProviderId, Session } from './types.js';

export type { FetchLike };

export interface ServerBackedAdapterOptions {
  /** Server route that verifies the provider payload and returns a session. */
  readonly authEndpoint?: string;
  readonly fetchImpl?: FetchLike;
}

export function readServerOptions(options: ServerBackedAdapterOptions | undefined): {
  authEndpoint?: string;
  fetchImpl?: FetchLike;
} {
  rejectClientSecrets(options);
  return {
    authEndpoint: options?.authEndpoint,
    fetchImpl: options?.fetchImpl,
  };
}

/**
 * POST a provider payload to the game server and accept only the session it returns.
 * No bot token, HMAC key, or client-minted production session is involved.
 */
export async function exchangeWithServer(options: {
  provider: IdentityProviderId;
  endpoint: string | undefined;
  fetchImpl: FetchLike | undefined;
  body: Record<string, unknown>;
  authorization?: string | null;
  requiredProvider?: IdentityProviderId;
}): Promise<Session> {
  if (typeof options.endpoint !== 'string' || options.endpoint.trim() === '') {
    throw new SdkError(
      ErrorCodes.NotImplemented,
      `${options.provider} auth is not implemented until a server auth endpoint is configured. This client does not mint sessions.`,
    );
  }
  const headers = new Headers({
    'content-type': 'application/json',
    accept: 'application/json',
  });
  if (options.authorization) headers.set('Authorization', options.authorization);
  const response = await (options.fetchImpl ?? fetch)(options.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body),
  });
  if (!response.ok) {
    throw new SdkError(
      ErrorCodes.Unauthenticated,
      `${options.provider} auth endpoint returned HTTP ${response.status}.`,
    );
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new SdkError(ErrorCodes.InvalidSession, 'Auth endpoint did not return a JSON session.');
  }
  return parseServerSession(payload, options.requiredProvider);
}

export async function linkWithServer(
  provider: 'google' | 'apple' | 'telegram',
  endpoint: string | undefined,
  fetchImpl: FetchLike | undefined,
  input: unknown,
): Promise<Session> {
  const request: LinkExchange = parseLinkRequest(input, null);
  if (request.provider !== provider) {
    throw new SdkError(ErrorCodes.LinkRejected, `This adapter links ${provider} identities only.`);
  }
  const body: Record<string, unknown> = {
    mode: 'link',
    provider,
    assertion: request.assertion,
  };
  let authorization: string | null = null;
  if (request.mode === 'session') {
    if (!request.session) {
      throw new SdkError(ErrorCodes.LinkRejected, 'Linking requires an authenticated server session.');
    }
    body.accountId = request.session.accountId;
    authorization = authorizationHeader(request.session);
  } else {
    body.existingIdentityProof = request.existingIdentityProof;
  }
  const linked = await exchangeWithServer({
    provider,
    endpoint,
    fetchImpl,
    body,
    authorization,
    requiredProvider: provider,
  });
  if (request.mode === 'session' && linked.accountId !== request.session?.accountId) {
    throw new SdkError(
      ErrorCodes.LinkRejected,
      'Linking must keep the current accountId and must not open a new account.',
    );
  }
  return linked;
}
