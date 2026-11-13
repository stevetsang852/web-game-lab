import {
  ErrorCodes,
  Observer,
  ProviderRegistry,
  SdkError,
  type Unsubscribe,
} from '@web-lab-sdk/core';
import type { UserGesture, WalletAccount, WalletLink, WalletPort, WalletProviderId } from './types.js';

const BLOCKED_WALLET_METHODS = ['checkout', 'mint', 'transfer'] as const;

/**
 * Facade for wallet linking. There is no mint API and no digital-goods checkout.
 * `connect` requires a user gesture and is not called while the client is constructed.
 */
export class Web3Client {
  private readonly registry = new ProviderRegistry<WalletPort>();
  private readonly changes = new Observer<WalletAccount | null>();
  private account: WalletAccount | null = null;

  register(provider: WalletPort): void {
    for (const key of BLOCKED_WALLET_METHODS) {
      if (key in provider) {
        throw new SdkError(
          ErrorCodes.WalletOperationReserved,
          `Wallet provider "${provider.id}" must not expose ${key}. A wallet is a link, not a checkout or mint path.`,
        );
      }
    }
    this.registry.register(provider);
  }

  registeredIds(): readonly string[] {
    return this.registry.ids();
  }

  getAccount(): WalletAccount | null {
    return this.account;
  }

  isConnected(): boolean {
    return this.account?.connected === true && this.account.address.length > 0;
  }

  onWalletChange(listener: (wallet: WalletAccount | null) => void): Unsubscribe {
    return this.changes.subscribe(listener);
  }

  /**
   * Connect after a click or tap. Missing a gesture does not call the adapter,
   * so constructing a client cannot open a wallet popup.
   */
  async connect(providerId: WalletProviderId, gesture?: UserGesture): Promise<WalletAccount> {
    if (!isUserGesture(gesture)) {
      throw new SdkError(
        ErrorCodes.WalletConnectRequiresGesture,
        'connect() requires an explicit user gesture and does not run on startup.',
      );
    }
    const provider = this.registry.require(providerId);
    const account = await provider.connect();
    if (!account || account.provider !== provider.id) {
      throw new SdkError(
        ErrorCodes.WalletProviderMismatch,
        `Wallet result provider "${String(account?.provider)}" does not match adapter "${provider.id}".`,
      );
    }
    if (provider.id === 'noop' || account.connected !== true || !account.address) {
      throw new SdkError(
        ErrorCodes.WalletNotConnected,
        'Refusing a wallet result that is not an explicit connection.',
      );
    }
    this.account = account;
    this.changes.notify(account);
    return account;
  }
}

export function isUserGesture(value: unknown): value is UserGesture {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<UserGesture>;
  return record.type === 'user-gesture' && record.explicit === true;
}

export function userGesture(): UserGesture {
  return { type: 'user-gesture', explicit: true };
}

/**
 * Record a link from a canonical account to a wallet address.
 * Passing the address as `accountId` is rejected. This does not mint.
 */
export function walletLink(accountId: string, account: WalletAccount): WalletLink {
  if (typeof accountId !== 'string' || accountId.trim() === '') {
    throw new SdkError(ErrorCodes.AccountOwnership, 'A wallet link requires the canonical accountId.');
  }
  const owner = accountId.trim();
  if (owner === account.address) {
    throw new SdkError(
      ErrorCodes.AccountOwnership,
      'Village, hero, and game ownership stay on accountId. The wallet address is only a link.',
    );
  }
  return Object.freeze({
    accountId: owner,
    provider: account.provider,
    address: account.address,
  });
}
