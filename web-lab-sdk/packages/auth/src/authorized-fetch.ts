import {
  OFFLINE_DEMO_ACCOUNT_PREFIX,
  OFFLINE_DEMO_TOKEN_PREFIX,
} from './session.js';
import type { Session } from './types.js';

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/**
 * Authorization header for a server-issued session.
 * Offline demo tokens return null so a production caller does not attach them.
 */
export function authorizationHeader(session: Session | null | undefined): string | null {
  if (!session || session.origin !== 'server') return null;
  if (!session.token || session.token.startsWith(OFFLINE_DEMO_TOKEN_PREFIX)) return null;
  if (session.accountId.startsWith(OFFLINE_DEMO_ACCOUNT_PREFIX)) return null;
  return `Bearer ${session.token}`;
}

/**
 * Thin wrapper that injects `Authorization` for one session.
 * It does not call payments, wallets, or a game API of its own.
 */
export function createAuthorizedFetch(session: Session | null, baseFetch: FetchLike = fetch): FetchLike {
  const authorization = authorizationHeader(session);
  return (input, init) => {
    const headers = new Headers(init?.headers);
    if (authorization) headers.set('Authorization', authorization);
    return baseFetch(input, { ...init, headers });
  };
}
