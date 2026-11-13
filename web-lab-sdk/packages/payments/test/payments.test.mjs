import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AppleIapPayments,
  GooglePlayPayments,
  INVOICE_STATES,
  MiniAppFactory,
  NativeFactory,
  NoopPayments,
  SdkError,
  StarsPayments,
  StripePayments,
  WebFactory,
  assertDigitalGoodsCurrency,
  assertInvoiceTransition,
} from '../dist/index.js';

async function rejects(run, code) {
  await assert.rejects(async () => {
    await run();
  }, (error) => {
    assert.ok(error instanceof SdkError);
    assert.equal(error.code, code);
    return true;
  });
}

test('invoice states follow INVOICE_OPEN to PAID to APPLIED or REFUNDED', () => {
  assert.deepEqual([...INVOICE_STATES], ['INVOICE_OPEN', 'PAID', 'APPLIED', 'REFUNDED']);
  assert.doesNotThrow(() => assertInvoiceTransition('INVOICE_OPEN', 'PAID'));
  assert.doesNotThrow(() => assertInvoiceTransition('PAID', 'APPLIED'));
  assert.doesNotThrow(() => assertInvoiceTransition('PAID', 'REFUNDED'));
  assert.throws(() => assertInvoiceTransition('INVOICE_OPEN', 'APPLIED'));
  assert.throws(() => assertInvoiceTransition('INVOICE_OPEN', 'REFUNDED'));
  assert.throws(() => assertInvoiceTransition('APPLIED', 'REFUNDED'));
  assert.throws(() => assertInvoiceTransition('REFUNDED', 'APPLIED'));
});

test('environment factories name defaults and leave live adapters unregistered', () => {
  const mini = new MiniAppFactory();
  const web = new WebFactory();
  const native = new NativeFactory();
  assert.deepEqual([...mini.defaultProviders], ['stars']);
  assert.equal(mini.defaultCurrency, 'XTR');
  assert.deepEqual([...web.defaultProviders], ['stripe']);
  assert.equal(web.defaultCurrency, 'USD');
  assert.deepEqual([...native.defaultProviders], ['apple_iap', 'google_play']);
  assert.deepEqual(mini.create().registeredIds(), []);
  assert.deepEqual(web.create().registeredIds(), []);
  assert.deepEqual(native.create().registeredIds(), []);
});

test('Stars uses XTR and TON is not a digital-goods checkout', async () => {
  const stars = new StarsPayments();
  assert.equal(stars.currency, 'XTR');
  assert.equal(stars.settles, false);
  await rejects(() => stars.checkout('potion', 'idem-stars-1'), 'NOT_IMPLEMENTED');
  assert.doesNotThrow(() => assertDigitalGoodsCurrency('mini_app', 'XTR'));
  assert.throws(
    () => assertDigitalGoodsCurrency('mini_app', 'USD'),
    (error) => error instanceof SdkError && error.code === 'DIGITAL_GOODS_CURRENCY_FORBIDDEN',
  );
  assert.throws(
    () => assertDigitalGoodsCurrency('web', 'ton'),
    (error) => error instanceof SdkError && error.code === 'DIGITAL_GOODS_CURRENCY_FORBIDDEN',
  );
  assert.doesNotThrow(() => assertDigitalGoodsCurrency('web', 'USD'));

  const mini = new MiniAppFactory().create();
  assert.throws(
    () => mini.register(new StripePayments()),
    (error) => error instanceof SdkError && error.code === 'DIGITAL_GOODS_CURRENCY_FORBIDDEN',
  );
  assert.throws(
    () => mini.register({
      id: 'stars',
      currency: 'TON',
      settles: false,
      async checkout() {
        throw new Error('should not charge');
      },
    }),
    (error) => error instanceof SdkError && error.code === 'DIGITAL_GOODS_CURRENCY_FORBIDDEN',
  );
  mini.register(stars);
  const seen = [];
  mini.onPayment((event) => seen.push(event.state));
  await rejects(() => mini.checkout('potion', 'idem-stars-1', 'stars'), 'NOT_IMPLEMENTED');
  assert.deepEqual(seen, []);
});

test('live IAP and Stripe scaffolds throw and reject client secrets', async () => {
  await rejects(() => new AppleIapPayments().checkout('potion', 'idem-apple-1'), 'NOT_IMPLEMENTED');
  await rejects(() => new GooglePlayPayments().checkout('potion', 'idem-play-1'), 'NOT_IMPLEMENTED');
  await rejects(() => new StripePayments().checkout('potion', 'idem-stripe-1'), 'NOT_IMPLEMENTED');
  assert.throws(
    () => new StripePayments({ secretKey: 'sk_live_not_a_real_key' }),
    (error) => error instanceof SdkError && error.code === 'CLIENT_SECRET_FORBIDDEN',
  );
  const web = new WebFactory().create();
  web.register(new StripePayments());
  await rejects(() => web.checkout('potion', 'idem-stripe-1', 'stripe'), 'NOT_IMPLEMENTED');
  await rejects(() => web.checkout('potion', 'idem-stripe-1', 'stripe'), 'NOT_IMPLEMENTED');
});

test('NoopPayments does not report a paid or applied purchase', async () => {
  const client = new MiniAppFactory().create({ phase0Demo: true });
  assert.deepEqual(client.registeredIds(), ['noop']);
  const seen = [];
  const stop = client.onPayment((event) => seen.push(event.state));
  const first = await client.checkout('potion', 'idem-noop-01');
  const replay = await client.checkout('potion', 'idem-noop-01');
  assert.equal(first, replay);
  assert.equal(first.state, 'INVOICE_OPEN');
  assert.equal(first.entitlementGranted, false);
  assert.equal(first.providerChargeId, undefined);
  assert.notEqual(first.state, 'PAID');
  assert.notEqual(first.state, 'APPLIED');
  assert.throws(() => {
    first.state = 'PAID';
  });
  await rejects(() => client.checkout('other', 'idem-noop-01'), 'IDEMPOTENCY_CONFLICT');
  await rejects(() => client.checkout('potion', 'short'), 'IDEMPOTENCY_KEY_REQUIRED');
  stop();
  await client.checkout('potion', 'idem-noop-02');
  assert.deepEqual(seen, ['INVOICE_OPEN']);
});

test('a stub cannot pretend the invoice settled, and items wait for APPLIED', async () => {
  const lying = new WebFactory().create();
  lying.register({
    id: 'noop',
    currency: 'NONE',
    settles: false,
    async checkout(sku, idempotencyKey) {
      return {
        id: 'noop:paid',
        sku,
        idempotencyKey,
        providerId: 'noop',
        currency: 'NONE',
        state: 'PAID',
        entitlementGranted: false,
      };
    },
  });
  await rejects(() => lying.checkout('potion', 'idem-paid-01'), 'SETTLED_STUB_FORBIDDEN');
  assert.equal(lying.registeredIds().includes('noop'), true);

  const early = new WebFactory().create();
  early.register({
    id: 'stripe',
    currency: 'USD',
    settles: true,
    async checkout(sku, idempotencyKey) {
      return {
        id: 'invoice-1',
        sku,
        idempotencyKey,
        providerId: 'stripe',
        currency: 'USD',
        state: 'PAID',
        providerChargeId: 'ch_test',
        entitlementGranted: true,
      };
    },
  });
  await rejects(() => early.checkout('potion', 'idem-early-1', 'stripe'), 'INVOICE_MISMATCH');
});

test('checkout keeps a completed invoice when a listener throws', async () => {
  let calls = 0;
  const client = new WebFactory().create();
  client.register({
    id: 'noop',
    currency: 'NONE',
    settles: false,
    async checkout(sku, idempotencyKey) {
      calls += 1;
      return {
        id: 'noop:listener',
        sku,
        idempotencyKey,
        providerId: 'noop',
        currency: 'NONE',
        state: 'INVOICE_OPEN',
        entitlementGranted: false,
      };
    },
  });
  client.onPayment(() => {
    throw new Error('listener failed');
  });
  const invoice = await client.checkout('potion', 'idem-listener-1');
  const replay = await client.checkout('potion', 'idem-listener-1');
  assert.equal(replay, invoice);
  assert.equal(calls, 1);
});

test('checkout rejects an invoice for a different sku, key, or later state', async () => {
  const mismatch = new WebFactory().create();
  mismatch.register({
    id: 'noop',
    currency: 'NONE',
    settles: false,
    async checkout(sku, idempotencyKey) {
      return {
        id: 'noop:wrong',
        sku: `${sku}-other`,
        idempotencyKey,
        providerId: 'noop',
        currency: 'NONE',
        state: 'INVOICE_OPEN',
        entitlementGranted: false,
      };
    },
  });
  await rejects(() => mismatch.checkout('potion', 'idem-sku-mismatch'), 'INVOICE_MISMATCH');

  const applied = new WebFactory().create();
  applied.register({
    id: 'stripe',
    currency: 'USD',
    settles: true,
    async checkout(sku, idempotencyKey) {
      return {
        id: 'invoice-applied',
        sku,
        idempotencyKey,
        providerId: 'stripe',
        currency: 'USD',
        state: 'APPLIED',
        entitlementGranted: true,
        providerChargeId: 'ch_test',
      };
    },
  });
  await rejects(() => applied.checkout('potion', 'idem-applied-1', 'stripe'), 'INVOICE_TRANSITION_FORBIDDEN');
});

test('NoopPayments itself never returns PAID or APPLIED', async () => {
  const invoice = await new NoopPayments().checkout('potion', 'idem-direct-1');
  assert.equal(invoice.state, 'INVOICE_OPEN');
  assert.equal(invoice.entitlementGranted, false);
});
