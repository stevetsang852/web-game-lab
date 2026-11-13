import { ErrorCodes, SdkError, rejectClientSecrets } from '@web-lab-sdk/core';
import type { WalletAccount, WalletPort } from './types.js';

export interface TonConnectOptions {
  /**
   * Disabled by default. Turning this on still does not open a wallet UI
   * or add a checkout path in this skeleton.
   */
  readonly enabled?: boolean;
}

/**
 * TON Connect placeholder.
 * It has no checkout, SKU, mint, or transfer method. Digital goods inside
 * Telegram use Stars (XTR) from `@web-lab-sdk/payments`.
 */
export class TonConnectAdapter implements WalletPort {
  readonly id = 'ton_connect' as const;
  readonly enabled: boolean;
  readonly supportsDigitalGoodsCheckout = false as const;

  constructor(options: TonConnectOptions = {}) {
    rejectClientSecrets(options);
    this.enabled = options.enabled === true;
  }

  async connect(): Promise<WalletAccount> {
    if (!this.enabled) {
      throw new SdkError(
        ErrorCodes.WalletDisabled,
        'TON Connect is disabled by default and does not open a wallet popup.',
      );
    }
    throw new SdkError(
      ErrorCodes.NotImplemented,
      'TON Connect is not implemented in this skeleton. It is not a digital-goods checkout.',
    );
  }
}

/** WalletConnect placeholder. It does not open a session or a QR modal. */
export class WalletConnectAdapter implements WalletPort {
  readonly id = 'walletconnect' as const;

  constructor(options?: unknown) {
    rejectClientSecrets(options);
  }

  async connect(): Promise<WalletAccount> {
    throw new SdkError(
      ErrorCodes.NotImplemented,
      'WalletConnect is a placeholder in this skeleton and does not open a session.',
    );
  }
}

/**
 * Null object for a Phase 0 demo.
 * Connecting does not report an address or a connected wallet.
 */
export class NoopWallet implements WalletPort {
  readonly id = 'noop' as const;

  async connect(): Promise<WalletAccount> {
    throw new SdkError(
      ErrorCodes.WalletNotConnected,
      'NoopWallet is not connected to a wallet and has no address.',
    );
  }
}
