/**
 * Identity port. Games depend on this contract, not on a provider SDK.
 * Strategy is selected by `id`; each class in `adapters/` is an Adapter.
 */
export type IdentityProviderId = 'telegram' | 'google' | 'apple' | 'offline';

/** Canonical linked identity. `subject` is the provider's stable id, never an email used as a join key. */
export interface LinkedIdentity {
  readonly provider: IdentityProviderId;
  readonly subject: string;
}

/**
 * `server` sessions are opaque bearer tokens issued by the game server.
 * `offline-demo` sessions exist only for the Phase 0 standalone demo and must
 * not be sent to a production API.
 */
export type SessionOrigin = 'server' | 'offline-demo';

export interface Session {
  /** Canonical user id. Village, hero, and game ownership stay on this id. */
  readonly accountId: string;
  readonly token: string;
  readonly expiresAt: string;
  readonly identities: readonly LinkedIdentity[];
  readonly origin: SessionOrigin;
}

export interface IdentityPort {
  readonly id: IdentityProviderId;
  authenticate(input: unknown): Promise<Session>;
  /** Bind a second identity onto an existing account. Must not open a new account. */
  link?(input: unknown): Promise<Session>;
}
