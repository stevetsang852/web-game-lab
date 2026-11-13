import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { GoogleIdentityAdapter, MiniAppFactory as MiniAppAuth, NativeFactory as NativeAuth, WebFactory as WebAuth } from '../packages/auth/dist/index.js';
import { MiniAppFactory as MiniAppPay, NativeFactory as NativePay, StarsPayments, WebFactory as WebPay } from '../packages/payments/dist/index.js';
import { MiniAppFactory as MiniAppWallet, WebFactory as WebWallet } from '../packages/web3/dist/index.js';

test('mini app defaults to Telegram initData plus Stars, with TON disconnected', async () => {
  const authFactory = new MiniAppAuth();
  const payFactory = new MiniAppPay();
  const walletFactory = new MiniAppWallet();
  assert.deepEqual([...authFactory.primaryIdentity], ['telegram']);
  assert.equal(authFactory.requiresWallet, false);
  assert.deepEqual([...payFactory.defaultProviders], ['stars']);
  assert.equal(payFactory.defaultCurrency, 'XTR');
  assert.equal(new StarsPayments().currency, 'XTR');
  assert.equal(walletFactory.enabledByDefault, false);
  assert.deepEqual([...walletFactory.defaultProviders], ['ton_connect']);

  const auth = authFactory.create();
  const payments = payFactory.create();
  const wallets = walletFactory.create();
  assert.equal(auth.checkout, undefined);
  assert.equal(auth.connect, undefined);
  assert.equal(payments.connect, undefined);
  assert.equal(wallets.checkout, undefined);
  assert.equal(wallets.mint, undefined);
  assert.deepEqual(payments.registeredIds(), []);
  assert.equal(wallets.isConnected(), false);

  auth.register(new GoogleIdentityAdapter());
  await assert.rejects(
    () => auth.authenticate('google', { assertion: 'gmail-assertion' }),
    (error) => error.code === 'PRIMARY_IDENTITY_REQUIRED',
  );
  await assert.rejects(
    () => auth.authenticate('apple', { assertion: 'apple-assertion' }),
    (error) => error.code === 'PRIMARY_IDENTITY_REQUIRED',
  );
});

test('web defaults to Google or Apple plus Stripe, and native defaults to store billing', () => {
  assert.deepEqual([...new WebAuth().primaryIdentity], ['google', 'apple']);
  assert.equal(new WebAuth().requiresWallet, false);
  assert.deepEqual([...new WebPay().defaultProviders], ['stripe']);
  assert.equal(new WebPay().defaultCurrency, 'USD');
  assert.equal(new WebWallet().enabledByDefault, false);
  assert.deepEqual([...new NativeAuth().primaryIdentity], ['google', 'apple']);
  assert.deepEqual([...new NativePay().defaultProviders], ['apple_iap', 'google_play']);
});

test('public package names stay split from core, payments, wallets, and realtime stacks', () => {
  const root = new URL('..', import.meta.url);
  const names = {
    auth: '@web-lab-sdk/auth',
    payments: '@web-lab-sdk/payments',
    web3: '@web-lab-sdk/web3',
  };
  for (const [dir, name] of Object.entries(names)) {
    const pkg = JSON.parse(readFileSync(new URL(`packages/${dir}/package.json`, root), 'utf8'));
    assert.equal(pkg.name, name);
    assert.equal(pkg.private, undefined);
    assert.equal(pkg.dependencies?.['@web-lab-sdk/core'], undefined);
    assert.equal(pkg.devDependencies['@web-lab-sdk/core'], '*');
    const built = readFileSync(new URL(`packages/${dir}/dist/index.js`, root), 'utf8');
    assert.equal(built.includes('@web-lab-sdk/core'), false);
    assert.equal(built.includes('_core/index.js'), true);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const banned of ['peerjs', 'stripe', '@stripe/stripe-js', '@tonconnect/sdk']) {
      assert.equal(deps[banned], undefined, banned);
    }
  }
  const auth = JSON.parse(readFileSync(new URL('packages/auth/package.json', root), 'utf8'));
  assert.equal(auth.dependencies?.['@web-lab-sdk/payments'], undefined);
  assert.equal(auth.dependencies?.['@web-lab-sdk/web3'], undefined);
  const payments = JSON.parse(readFileSync(new URL('packages/payments/package.json', root), 'utf8'));
  assert.equal(payments.dependencies?.['@web-lab-sdk/web3'], undefined);
  const core = JSON.parse(readFileSync(new URL('packages/core/package.json', root), 'utf8'));
  assert.equal(core.private, true);
  assert.equal(core.name, '@web-lab-sdk/core');
});
