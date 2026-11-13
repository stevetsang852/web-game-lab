import type { EnvironmentFactory } from '@web-lab-sdk/core';
import { AppleIdentityAdapter, GoogleIdentityAdapter } from './adapters/assertion.js';
import { OfflineAuth } from './adapters/offline.js';
import { TelegramIdentityAdapter } from './adapters/telegram.js';
import { AuthClient } from './client.js';
import type { ServerBackedAdapterOptions } from './server.js';
import type { IdentityProviderId } from './types.js';

export interface AuthFactoryOptions extends ServerBackedAdapterOptions {
  /**
   * Phase 0 standalone demo. Registers OfflineAuth and allows the `offline` primary id.
   * The resulting session is labeled offline-demo and is not a server bearer.
   */
  readonly phase0Demo?: boolean;
}

/**
 * Mini App login is Telegram initData verified by the server.
 * Google and Apple are not on this login gate. Login does not open a wallet.
 */
export class MiniAppFactory implements EnvironmentFactory<AuthClient, AuthFactoryOptions> {
  readonly environment = 'mini_app' as const;
  readonly primaryIdentity = ['telegram'] as const satisfies readonly IdentityProviderId[];
  readonly requiresWallet = false as const;

  create(options: AuthFactoryOptions = {}): AuthClient {
    const allowedPrimary: IdentityProviderId[] = options.phase0Demo
      ? ['telegram', 'offline']
      : ['telegram'];
    const client = new AuthClient({
      environment: 'mini_app',
      allowedPrimary,
      lockPrimary: true,
    });
    client.register(new TelegramIdentityAdapter(options));
    if (options.phase0Demo) client.register(new OfflineAuth());
    return client;
  }
}

/** Web login offers Google and Sign in with Apple. Neither one is a wallet connect. */
export class WebFactory implements EnvironmentFactory<AuthClient, AuthFactoryOptions> {
  readonly environment = 'web' as const;
  readonly primaryIdentity = ['google', 'apple'] as const satisfies readonly IdentityProviderId[];
  readonly requiresWallet = false as const;

  create(options: AuthFactoryOptions = {}): AuthClient {
    const allowedPrimary: IdentityProviderId[] = options.phase0Demo
      ? ['google', 'apple', 'offline']
      : ['google', 'apple'];
    const client = new AuthClient({
      environment: 'web',
      allowedPrimary,
      lockPrimary: false,
    });
    client.register(new GoogleIdentityAdapter(options));
    client.register(new AppleIdentityAdapter(options));
    if (options.phase0Demo) client.register(new OfflineAuth());
    return client;
  }
}

/** Native login uses the same server-verified Google and Apple assertions. */
export class NativeFactory implements EnvironmentFactory<AuthClient, AuthFactoryOptions> {
  readonly environment = 'native' as const;
  readonly primaryIdentity = ['google', 'apple'] as const satisfies readonly IdentityProviderId[];
  readonly requiresWallet = false as const;

  create(options: AuthFactoryOptions = {}): AuthClient {
    const allowedPrimary: IdentityProviderId[] = options.phase0Demo
      ? ['google', 'apple', 'offline']
      : ['google', 'apple'];
    const client = new AuthClient({
      environment: 'native',
      allowedPrimary,
      lockPrimary: false,
    });
    client.register(new GoogleIdentityAdapter(options));
    client.register(new AppleIdentityAdapter(options));
    if (options.phase0Demo) client.register(new OfflineAuth());
    return client;
  }
}
