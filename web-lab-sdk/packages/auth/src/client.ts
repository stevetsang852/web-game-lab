import {
  ErrorCodes,
  Observer,
  ProviderRegistry,
  SdkError,
  type Unsubscribe,
} from '@web-lab-sdk/core';
import type { LabEnvironment } from '@web-lab-sdk/core';
import { authorizationHeader } from './authorized-fetch.js';
import { parseLinkRequest } from './link.js';
import { assertIssuedSession } from './session.js';
import type { IdentityPort, IdentityProviderId, Session } from './types.js';

export interface AuthClientOptions {
  readonly environment: LabEnvironment;
  readonly allowedPrimary: readonly IdentityProviderId[];
  /** When true, Google/Apple cannot be promoted to the Mini App login gate. */
  readonly lockPrimary: boolean;
}

/**
 * Facade. Games authenticate, link, and read the bearer token here.
 * Payments and wallets are separate clients.
 */
export class AuthClient {
  readonly environment: LabEnvironment;
  private readonly registry = new ProviderRegistry<IdentityPort>();
  private readonly changes = new Observer<Session | null>();
  private readonly allowedPrimary: IdentityProviderId[];
  private readonly lockPrimary: boolean;
  private session: Session | null = null;

  constructor(options: AuthClientOptions) {
    this.environment = options.environment;
    this.allowedPrimary = [...options.allowedPrimary];
    this.lockPrimary = options.lockPrimary;
  }

  /**
   * Register an adapter at bootstrap.
   * `primary: true` is rejected when the factory locked the login gate
   * (Mini App stays on Telegram initData).
   */
  register(provider: IdentityPort, options?: { primary?: boolean }): void {
    if (options?.primary) this.permitPrimary(provider.id);
    this.registry.register(provider);
  }

  registeredIds(): readonly string[] {
    return this.registry.ids();
  }

  primaryProviders(): readonly IdentityProviderId[] {
    return [...this.allowedPrimary];
  }

  async authenticate(providerId: IdentityProviderId, input: unknown): Promise<Session> {
    if (!this.allowedPrimary.includes(providerId)) {
      throw new SdkError(
        ErrorCodes.PrimaryIdentityRequired,
        `Primary login for ${this.environment} does not accept "${providerId}". Allowed: ${this.allowedPrimary.join(', ')}.`,
      );
    }
    const provider = this.registry.require(providerId);
    const session = await provider.authenticate(input);
    this.commit(session);
    return session;
  }

  /**
   * Bind a second identity onto the current account.
   * Email-only input is rejected. A raw Google/Apple assertion does not attach
   * unless the caller already holds a server session or supplies dual proof.
   */
  async link(input: unknown): Promise<Session> {
    const request = parseLinkRequest(input, this.session);
    const provider = this.registry.require(request.provider);
    if (typeof provider.link !== 'function') {
      throw new SdkError(ErrorCodes.NotImplemented, `${request.provider} does not support linking.`);
    }
    const activeAccountId = this.session?.accountId;
    const linked = await provider.link(request);
    if (activeAccountId && linked.accountId !== activeAccountId) {
      throw new SdkError(
        ErrorCodes.LinkRejected,
        'Linking must keep the active accountId and must not open a new account.',
      );
    }
    if (request.mode === 'session' && request.session && linked.accountId !== request.session.accountId) {
      throw new SdkError(
        ErrorCodes.LinkRejected,
        'Linking must keep the current accountId and must not open a new account.',
      );
    }
    if (!linked.identities.some((identity) => identity.provider === request.provider)) {
      throw new SdkError(ErrorCodes.InvalidSession, 'Linked session is missing the new identity.');
    }
    this.commit(linked);
    return linked;
  }

  onSessionChange(listener: (session: Session | null) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  getSession(): Session | null {
    return this.session;
  }

  /** Raw token, including an `offline-demo.` token when the session is local. */
  getAccessToken(): string | null {
    return this.session?.token ?? null;
  }

  /**
   * `Bearer <token>` for a server session, or null for a missing or offline demo session.
   * A separate HTTP caller can set `Authorization` from this value.
   */
  getAuthorization(): string | null {
    return authorizationHeader(this.session);
  }

  logout(): void {
    if (this.session === null) return;
    this.session = null;
    this.changes.notify(null);
  }

  private permitPrimary(id: IdentityProviderId): void {
    if (this.allowedPrimary.includes(id)) return;
    if (this.lockPrimary) {
      throw new SdkError(
        ErrorCodes.PrimaryIdentityRequired,
        `Primary login for ${this.environment} is locked. Verify Telegram initData before using ${id}.`,
      );
    }
    this.allowedPrimary.push(id);
  }

  private commit(session: Session): void {
    assertIssuedSession(session);
    this.session = session;
    this.changes.notify(session);
  }
}
