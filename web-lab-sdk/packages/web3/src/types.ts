export type WalletProviderId = 'ton_connect' | 'walletconnect' | 'noop';

/**
 * A connected wallet. `accountId` is the game account this address may be linked to.
 * The address is not the owner of village, hero, or other game data.
 */
export interface WalletAccount {
  readonly provider: WalletProviderId;
  readonly address: string;
  readonly connected: true;
  readonly accountId: string | null;
}

/** Explicit user gesture. Connect refuses to run without one, including on startup. */
export interface UserGesture {
  readonly type: 'user-gesture';
  readonly explicit: true;
}

export interface WalletPort {
  readonly id: WalletProviderId;
  /** Must be called only after an explicit gesture. Never connect from a constructor. */
  connect(): Promise<WalletAccount>;
}

/** Link a wallet address to a canonical account. Ownership stays on `accountId`. */
export interface WalletLink {
  readonly accountId: string;
  readonly provider: WalletProviderId;
  readonly address: string;
}
