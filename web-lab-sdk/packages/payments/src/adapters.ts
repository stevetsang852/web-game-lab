import { ErrorCodes, SdkError, rejectClientSecrets } from '@web-lab-sdk/core';
import type { Invoice, PaymentPort } from './types.js';

const NOT_LIVE = 'No invoice was opened and no charge was created.';

function rejectSecrets(options: unknown): void {
  rejectClientSecrets(options);
}

/** Telegram Stars. Currency is always XTR. Checkout is a non-functional scaffold. */
export class StarsPayments implements PaymentPort {
  readonly id = 'stars' as const;
  readonly currency = 'XTR' as const;
  readonly settles = false;

  constructor(options?: unknown) {
    rejectSecrets(options);
  }

  async checkout(_sku: string, _idempotencyKey: string): Promise<Invoice> {
    throw new SdkError(
      ErrorCodes.NotImplemented,
      `Telegram Stars (XTR) checkout is not implemented in this skeleton. ${NOT_LIVE}`,
    );
  }
}

/** Apple In-App Purchase scaffold. Unregistered by default and not able to charge. */
export class AppleIapPayments implements PaymentPort {
  readonly id = 'apple_iap' as const;
  readonly currency = 'USD' as const;
  readonly settles = false;

  constructor(options?: unknown) {
    rejectSecrets(options);
  }

  async checkout(_sku: string, _idempotencyKey: string): Promise<Invoice> {
    throw new SdkError(
      ErrorCodes.NotImplemented,
      `Apple IAP checkout is not implemented in this skeleton. ${NOT_LIVE}`,
    );
  }
}

/** Google Play Billing scaffold. Unregistered by default and not able to charge. */
export class GooglePlayPayments implements PaymentPort {
  readonly id = 'google_play' as const;
  readonly currency = 'USD' as const;
  readonly settles = false;

  constructor(options?: unknown) {
    rejectSecrets(options);
  }

  async checkout(_sku: string, _idempotencyKey: string): Promise<Invoice> {
    throw new SdkError(
      ErrorCodes.NotImplemented,
      `Google Play Billing checkout is not implemented in this skeleton. ${NOT_LIVE}`,
    );
  }
}

/** Stripe scaffold. Unregistered by default. This package does not take a Stripe secret key. */
export class StripePayments implements PaymentPort {
  readonly id = 'stripe' as const;
  readonly currency = 'USD' as const;
  readonly settles = false;

  constructor(options?: unknown) {
    rejectSecrets(options);
  }

  async checkout(_sku: string, _idempotencyKey: string): Promise<Invoice> {
    throw new SdkError(
      ErrorCodes.NotImplemented,
      `Stripe checkout is not implemented in this skeleton. ${NOT_LIVE}`,
    );
  }
}

/**
 * Null object for a Phase 0 demo.
 * Checkout stays at INVOICE_OPEN and never reports PAID or APPLIED.
 */
export class NoopPayments implements PaymentPort {
  readonly id = 'noop' as const;
  readonly currency = 'NONE';
  readonly settles = false;
  private readonly issued = new Map<string, Invoice>();

  async checkout(sku: string, idempotencyKey: string): Promise<Invoice> {
    const existing = this.issued.get(idempotencyKey);
    if (existing) {
      if (existing.sku !== sku) {
        throw new SdkError(
          ErrorCodes.IdempotencyConflict,
          'idempotencyKey was already used for a different sku.',
        );
      }
      return existing;
    }
    const invoice = Object.freeze({
      id: `noop:${idempotencyKey}`,
      sku,
      idempotencyKey,
      providerId: this.id,
      currency: this.currency,
      state: 'INVOICE_OPEN' as const,
      entitlementGranted: false,
    });
    this.issued.set(idempotencyKey, invoice);
    return invoice;
  }
}
