import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MiniAppFactory,
  NativeFactory,
  NoopWallet,
  SdkError,
  TonConnectAdapter,
  WalletConnectAdapter,
  WebFactory,
  userGesture,
  walletLink,
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

test('wallet factories stay disconnected and disabled on startup', () => {
  for (const factory of [new MiniAppFactory(), new WebFactory(), new NativeFactory()]) {
    assert.equal(factory.enabledByDefault, false);
    assert.equal(factory.requiredForLogin, false);
    const client = factory.create();
    assert.equal(client.isConnected(), false);
    assert.equal(client.getAccount(), null);
    assert.deepEqual(client.registeredIds(), []);
  }
  assert.deepEqual([...new MiniAppFactory().defaultProviders], ['ton_connect']);
  assert.deepEqual([...new WebFactory().defaultProviders], ['walletconnect']);
});

test('TON Connect is disabled, has no checkout or mint, and does not pop up', async () => {
  const ton = new TonConnectAdapter();
  assert.equal(ton.enabled, false);
  assert.equal(ton.supportsDigitalGoodsCheckout, false);
  assert.equal('checkout' in ton, false);
  assert.equal('mint' in ton, false);
  assert.equal('transfer' in ton, false);
  await rejects(() => ton.connect(), 'WALLET_DISABLED');
  await rejects(() => new TonConnectAdapter({ enabled: true }).connect(), 'NOT_IMPLEMENTED');

  const client = new MiniAppFactory().create();
  let calls = 0;
  client.register({
    id: 'ton_connect',
    async connect() {
      calls += 1;
      return { provider: 'ton_connect', address: 'EQ_test', connected: true, accountId: 'acc_1' };
    },
  });
  await rejects(() => client.connect('ton_connect'), 'WALLET_CONNECT_REQUIRES_GESTURE');
  await rejects(() => client.connect('ton_connect', { explicit: true }), 'WALLET_CONNECT_REQUIRES_GESTURE');
  assert.equal(calls, 0);
  assert.equal(client.isConnected(), false);
});

test('NoopWallet and WalletConnect do not report a connected wallet', async () => {
  const demo = new MiniAppFactory().create({ phase0Demo: true });
  assert.deepEqual(demo.registeredIds(), ['noop']);
  await rejects(() => demo.connect('noop', userGesture()), 'WALLET_NOT_CONNECTED');
  assert.equal(demo.isConnected(), false);
  assert.equal(demo.getAccount(), null);
  await rejects(() => new NoopWallet().connect(), 'WALLET_NOT_CONNECTED');
  await rejects(() => new WalletConnectAdapter().connect(), 'NOT_IMPLEMENTED');

  const lying = new WebFactory().create();
  lying.register({
    id: 'noop',
    async connect() {
      return { provider: 'noop', address: 'should-not-stick', connected: true, accountId: null };
    },
  });
  await rejects(() => lying.connect('noop', userGesture()), 'WALLET_NOT_CONNECTED');
  assert.equal(lying.getAccount(), null);
  assert.equal(lying.isConnected(), false);
});

test('connect notifies after a gesture, and a wallet cannot mint or own the account', async () => {
  const client = new WebFactory().create();
  const seen = [];
  const stop = client.onWalletChange((wallet) => seen.push(wallet?.address ?? null));
  client.register({
    id: 'walletconnect',
    async connect() {
      return { provider: 'walletconnect', address: 'wc-addr', connected: true, accountId: 'acc_1' };
    },
  });
  const account = await client.connect('walletconnect', userGesture());
  assert.equal(client.isConnected(), true);
  assert.equal(account.address, 'wc-addr');
  stop();
  assert.deepEqual(seen, ['wc-addr']);

  assert.throws(
    () => walletLink('wc-addr', account),
    (error) => error instanceof SdkError && error.code === 'ACCOUNT_OWNERSHIP',
  );
  assert.deepEqual(walletLink('acc_1', account), {
    accountId: 'acc_1',
    provider: 'walletconnect',
    address: 'wc-addr',
  });
  assert.throws(
    () => client.register({
      id: 'ton_connect',
      checkout() {},
      async connect() {
        throw new Error('should not connect');
      },
    }),
    (error) => error instanceof SdkError && error.code === 'WALLET_OPERATION_RESERVED',
  );
});
