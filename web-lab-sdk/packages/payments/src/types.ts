export const INVOICE_STATES = ['INVOICE_OPEN', 'PAID', 'APPLIED', 'REFUNDED'] as const;

/** INVOICE_OPEN → PAID → APPLIED | REFUNDED. Stubs stop at INVOICE_OPEN. */
export type InvoiceState = (typeof INVOICE_STATES)[number];

export type PaymentProviderId = 'stars' | 'apple_iap' | 'google_play' | 'stripe' | 'noop';

export interface Invoice {
  readonly id: string;
  readonly sku: string;
  readonly idempotencyKey: string;
  readonly providerId: PaymentProviderId;
  readonly currency: string;
  readonly state: InvoiceState;
  /** Present only after a provider charge exists. Stubs omit it. */
  readonly providerChargeId?: string;
  /** True only when a server has applied the entitlement. Stubs leave this false. */
  readonly entitlementGranted: boolean;
}

export interface PaymentPort {
  readonly id: PaymentProviderId;
  readonly currency: 'XTR' | 'USD' | string;
  /**
   * False for Phase 0 and for the non-functional Stars, IAP, and Stripe scaffolds.
   * A `settles: false` adapter must not return PAID, APPLIED, or a charge id.
   */
  readonly settles: boolean;
  checkout(sku: string, idempotencyKey: string): Promise<Invoice>;
}

export interface PaymentEvent {
  readonly state: InvoiceState;
  readonly invoice: Invoice;
}
