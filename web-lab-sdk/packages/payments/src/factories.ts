import type { EnvironmentFactory } from '@web-lab-sdk/core';
import { NoopPayments } from './adapters.js';
import { PaymentsClient } from './client.js';
import type { PaymentProviderId } from './types.js';

export interface PaymentsFactoryOptions {
  /** Register NoopPayments for a Phase 0 demo. Live adapters stay unregistered. */
  readonly phase0Demo?: boolean;
}

function createClient(
  environment: 'mini_app' | 'web' | 'native',
  options: PaymentsFactoryOptions | undefined,
): PaymentsClient {
  const client = new PaymentsClient(environment);
  if (options?.phase0Demo) client.register(new NoopPayments());
  return client;
}

/** Mini App digital goods default to Telegram Stars (XTR). The scaffold is not registered. */
export class MiniAppFactory implements EnvironmentFactory<PaymentsClient, PaymentsFactoryOptions> {
  readonly environment = 'mini_app' as const;
  readonly defaultProviders = ['stars'] as const satisfies readonly PaymentProviderId[];
  readonly defaultCurrency = 'XTR' as const;

  create(options?: PaymentsFactoryOptions): PaymentsClient {
    return createClient('mini_app', options);
  }
}

/** Web defaults to Stripe. The scaffold is not registered and cannot charge. */
export class WebFactory implements EnvironmentFactory<PaymentsClient, PaymentsFactoryOptions> {
  readonly environment = 'web' as const;
  readonly defaultProviders = ['stripe'] as const satisfies readonly PaymentProviderId[];
  readonly defaultCurrency = 'USD' as const;

  create(options?: PaymentsFactoryOptions): PaymentsClient {
    return createClient('web', options);
  }
}

/** Native defaults to Apple IAP and Google Play Billing. Neither scaffold is registered. */
export class NativeFactory implements EnvironmentFactory<PaymentsClient, PaymentsFactoryOptions> {
  readonly environment = 'native' as const;
  readonly defaultProviders = ['apple_iap', 'google_play'] as const satisfies readonly PaymentProviderId[];
  readonly defaultCurrency = 'USD' as const;

  create(options?: PaymentsFactoryOptions): PaymentsClient {
    return createClient('native', options);
  }
}
