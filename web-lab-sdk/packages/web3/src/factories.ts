import type { EnvironmentFactory } from '@web-lab-sdk/core';
import { NoopWallet } from './adapters.js';
import { Web3Client } from './client.js';
import type { WalletProviderId } from './types.js';

export interface Web3FactoryOptions {
  /** Register NoopWallet. It stays disconnected until a gesture, and even then reports no wallet. */
  readonly phase0Demo?: boolean;
}

function createClient(options?: Web3FactoryOptions): Web3Client {
  const client = new Web3Client();
  if (options?.phase0Demo) client.register(new NoopWallet());
  return client;
}

/**
 * Mini App names TON Connect as the wallet adapter, but it is disabled and
 * unregistered. Login and digital-goods checkout do not use it.
 */
export class MiniAppFactory implements EnvironmentFactory<Web3Client, Web3FactoryOptions> {
  readonly environment = 'mini_app' as const;
  readonly defaultProviders = ['ton_connect'] as const satisfies readonly WalletProviderId[];
  readonly enabledByDefault = false as const;
  readonly requiredForLogin = false as const;

  create(options?: Web3FactoryOptions): Web3Client {
    return createClient(options);
  }
}

/** Web names a WalletConnect placeholder. It is unregistered and does not open on startup. */
export class WebFactory implements EnvironmentFactory<Web3Client, Web3FactoryOptions> {
  readonly environment = 'web' as const;
  readonly defaultProviders = ['walletconnect'] as const satisfies readonly WalletProviderId[];
  readonly enabledByDefault = false as const;
  readonly requiredForLogin = false as const;

  create(options?: Web3FactoryOptions): Web3Client {
    return createClient(options);
  }
}

/** Native does not require a wallet for login. WalletConnect stays a placeholder. */
export class NativeFactory implements EnvironmentFactory<Web3Client, Web3FactoryOptions> {
  readonly environment = 'native' as const;
  readonly defaultProviders = ['walletconnect'] as const satisfies readonly WalletProviderId[];
  readonly enabledByDefault = false as const;
  readonly requiredForLogin = false as const;

  create(options?: Web3FactoryOptions): Web3Client {
    return createClient(options);
  }
}
