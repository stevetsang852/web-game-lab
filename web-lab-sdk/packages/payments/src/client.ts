import {
  ErrorCodes,
  Observer,
  ProviderRegistry,
  SdkError,
  type LabEnvironment,
  type Unsubscribe,
} from '@web-lab-sdk/core';
import { isInvoiceState } from './invoice.js';
import { assertDigitalGoodsCurrency, normalizeCurrency } from './policy.js';
import type { Invoice, PaymentEvent, PaymentPort, PaymentProviderId } from './types.js';

interface CachedCheckout {
  readonly sku: string;
  readonly pending: Promise<Invoice>;
}

/**
 * Facade over payment adapters. Games check out here.
 * The client does not talk to wallets and does not grant items itself.
 */
export class PaymentsClient {
  readonly environment: LabEnvironment;
  private readonly registry = new ProviderRegistry<PaymentPort>();
  private readonly payments = new Observer<PaymentEvent>();
  private readonly cache = new Map<string, CachedCheckout>();

  constructor(environment: LabEnvironment) {
    this.environment = environment;
  }

  register(provider: PaymentPort): void {
    this.assertCanRegister(provider);
    this.registry.register(provider);
  }

  registeredIds(): readonly string[] {
    return this.registry.ids();
  }

  onPayment(listener: (event: PaymentEvent) => void): Unsubscribe {
    return this.payments.subscribe(listener);
  }

  /**
   * Start or replay a checkout. `idempotencyKey` replays the same attempt.
   * When `providerId` is omitted, exactly one registered adapter must exist.
   */
  async checkout(sku: string, idempotencyKey: string, providerId?: PaymentProviderId): Promise<Invoice> {
    if (typeof sku !== 'string' || sku.trim() === '') {
      throw new SdkError(ErrorCodes.InvalidArgument, 'checkout requires a sku.');
    }
    if (typeof idempotencyKey !== 'string' || idempotencyKey.trim().length < 8) {
      throw new SdkError(
        ErrorCodes.IdempotencyKeyRequired,
        'checkout requires an idempotencyKey of at least 8 characters.',
      );
    }
    const provider = this.registry.require(providerId ?? this.onlyProviderId());
    const cacheKey = `${provider.id}:${idempotencyKey}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (cached.sku !== sku) {
        throw new SdkError(
          ErrorCodes.IdempotencyConflict,
          'idempotencyKey was already used for a different sku.',
        );
      }
      return cached.pending;
    }
    const pending = this.runCheckout(provider, sku, idempotencyKey);
    this.cache.set(cacheKey, { sku, pending });
    try {
      return await pending;
    } catch (error) {
      if (this.cache.get(cacheKey)?.pending === pending) this.cache.delete(cacheKey);
      throw error;
    }
  }

  private onlyProviderId(): PaymentProviderId {
    const ids = this.registry.ids();
    if (ids.length !== 1) {
      throw new SdkError(
        ErrorCodes.ProviderNotRegistered,
        'Pass a payment provider id. None or several are registered.',
      );
    }
    return ids[0] as PaymentProviderId;
  }

  private async runCheckout(provider: PaymentPort, sku: string, idempotencyKey: string): Promise<Invoice> {
    const invoice = this.publish(provider, await provider.checkout(sku, idempotencyKey));
    this.payments.notify({ state: invoice.state, invoice });
    return invoice;
  }

  private publish(provider: PaymentPort, invoice: Invoice): Invoice {
    if (!invoice || invoice.providerId !== provider.id || invoice.currency !== provider.currency) {
      throw new SdkError(ErrorCodes.InvoiceMismatch, 'Invoice does not match the payment adapter.');
    }
    if (!isInvoiceState(invoice.state)) {
      throw new SdkError(ErrorCodes.InvoiceTransitionForbidden, 'Unknown invoice state.');
    }
    if (invoice.entitlementGranted && invoice.state !== 'APPLIED') {
      throw new SdkError(
        ErrorCodes.InvoiceMismatch,
        'An entitlement is granted only when the invoice reaches APPLIED.',
      );
    }
    if (!provider.settles) {
      if (
        invoice.state !== 'INVOICE_OPEN' ||
        invoice.entitlementGranted ||
        typeof invoice.providerChargeId === 'string'
      ) {
        throw new SdkError(
          ErrorCodes.SettledStubForbidden,
          `${provider.id} must not report a paid, applied, or charged purchase.`,
        );
      }
    }
    if (provider.id !== 'noop') assertDigitalGoodsCurrency(this.environment, invoice.currency);
    return Object.freeze({ ...invoice });
  }

  private assertCanRegister(provider: PaymentPort): void {
    const currency = normalizeCurrency(provider.currency);
    if (currency === 'TON' || (provider.id === 'stars' && currency !== 'XTR')) {
      throw new SdkError(
        ErrorCodes.DigitalGoodsCurrencyForbidden,
        provider.id === 'stars'
          ? 'The Stars adapter must use currency XTR.'
          : 'TON cannot be used to check out digital goods. Inside Telegram, sell items with Stars (XTR) only.',
      );
    }
    if (this.environment === 'mini_app' && provider.id !== 'stars' && provider.id !== 'noop') {
      throw new SdkError(
        ErrorCodes.DigitalGoodsCurrencyForbidden,
        `Mini App payments cannot register "${provider.id}". Digital goods use Stars (XTR) only.`,
      );
    }
    if (this.environment === 'mini_app' && provider.id === 'stars') {
      assertDigitalGoodsCurrency('mini_app', provider.currency);
    }
  }
}
