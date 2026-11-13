import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  AppleIdentityAdapter,
  AuthClient,
  GoogleIdentityAdapter,
  MiniAppFactory,
  OfflineAuth,
  SdkError,
  TelegramIdentityAdapter,
  WebFactory,
  createAuthorizedFetch,
} from '../dist/index.js';

const ENDPOINT = 'https://auth.example.test/session';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function recorder() {
  const requests = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    const headers = new Headers(init.headers);
    requests.push({
      url,
      body,
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
    });
    if (body.mode === 'link') {
      return jsonResponse({
        accountId: body.assertion === 'open-new-account' ? 'acc_other' : 'acc_1',
        token: 'linked-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        identities: [
          { provider: 'telegram', subject: 'tg-1' },
          { provider: body.provider, subject: `${body.provider}-sub` },
        ],
      });
    }
    return jsonResponse({
      accountId: 'acc_1',
      token: 'opaque-server-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      identities: [{ provider: body.provider, subject: `${body.provider}-sub` }],
    });
  };
  return { requests, fetchImpl };
}

async function rejects(run, code) {
  await assert.rejects(async () => {
    await run();
  }, (error) => {
    assert.ok(error instanceof SdkError);
    assert.equal(error.code, code);
    return true;
  });
}

test('environment factories pick a primary identity and do not require a wallet', () => {
  const mini = new MiniAppFactory();
  const web = new WebFactory();
  assert.deepEqual([...mini.primaryIdentity], ['telegram']);
  assert.deepEqual([...web.primaryIdentity], ['google', 'apple']);
  assert.equal(mini.requiresWallet, false);
  assert.equal(web.requiresWallet, false);
  assert.deepEqual(mini.create().primaryProviders(), ['telegram']);
  assert.deepEqual(web.create().primaryProviders(), ['google', 'apple']);
  assert.deepEqual(mini.create().registeredIds(), ['telegram']);
  assert.deepEqual(web.create().registeredIds(), ['google', 'apple']);
});

test('Mini App login stays on Telegram even if Google or Apple is registered', async () => {
  const { fetchImpl, requests } = recorder();
  const client = new MiniAppFactory().create({ authEndpoint: ENDPOINT, fetchImpl });
  client.register(new GoogleIdentityAdapter({ authEndpoint: ENDPOINT, fetchImpl }));
  await rejects(
    () => client.authenticate('google', { assertion: 'gmail-assertion', email: 'a@gmail.com' }),
    'PRIMARY_IDENTITY_REQUIRED',
  );
  await rejects(
    () => client.authenticate('apple', { assertion: 'apple-assertion' }),
    'PRIMARY_IDENTITY_REQUIRED',
  );
  assert.throws(
    () => client.register(new AppleIdentityAdapter(), { primary: true }),
    (error) => error instanceof SdkError && error.code === 'PRIMARY_IDENTITY_REQUIRED',
  );
  assert.equal(requests.length, 0);
  assert.equal(client.getSession(), null);

  const session = await client.authenticate('telegram', { initData: 'auth_date=1&hash=server-side' });
  assert.equal(session.accountId, 'acc_1');
  assert.equal(session.identities[0].provider, 'telegram');
  assert.deepEqual(requests[0].body, {
    provider: 'telegram',
    initData: 'auth_date=1&hash=server-side',
  });

  const linked = await client.link({ provider: 'google', assertion: 'google-assertion' });
  assert.equal(linked.accountId, 'acc_1');
  assert.equal(linked.identities.some((identity) => identity.provider === 'google'), true);
  assert.equal(requests[1].body.email, undefined);
  assert.equal(requests[1].authorization, 'Bearer opaque-server-token');
});

test('Phase 0 offline auth is labeled demo and is not a production bearer', async () => {
  const demo = new MiniAppFactory().create({ phase0Demo: true });
  await rejects(() => demo.authenticate('google', { assertion: 'x' }), 'PRIMARY_IDENTITY_REQUIRED');
  const seen = [];
  const stop = demo.onSessionChange((session) => seen.push(session?.origin ?? null));
  const session = await demo.authenticate('offline', {});
  assert.equal(session.origin, 'offline-demo');
  assert.match(session.token, /^offline-demo\.[0-9a-f-]{36}$/);
  assert.match(session.accountId, /^offline-demo:[0-9a-f-]{36}$/);
  assert.equal(session.token.split('.').length, 2);
  assert.equal(session.token.startsWith('eyJ'), false);
  assert.deepEqual(session.identities, [{ provider: 'offline', subject: 'local-demo' }]);
  assert.equal(demo.getAccessToken(), session.token);
  assert.equal(demo.getAuthorization(), null);
  assert.throws(() => {
    session.origin = 'server';
  });
  const other = await new OfflineAuth().authenticate({});
  assert.notEqual(other.token, session.token);

  let authorization;
  await createAuthorizedFetch(session, async (_url, init) => {
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(null, { status: 204 });
  })('https://game.example.test/me');
  assert.equal(authorization, null);

  demo.logout();
  stop();
  await demo.authenticate('offline', {});
  assert.deepEqual(seen, ['offline-demo', null]);
});

test('offline auth rejects a caller-supplied session', async () => {
  const demo = new MiniAppFactory().create({ phase0Demo: true });
  await rejects(
    () => demo.authenticate('offline', { token: 'eyJ.header.payload', accountId: 'user_1' }),
    'INVALID_SESSION',
  );
  assert.equal(demo.getAccessToken(), null);
});

test('linking rejects email-only attach and does not call the server', async () => {
  const { fetchImpl, requests } = recorder();
  const client = new WebFactory().create({ authEndpoint: ENDPOINT, fetchImpl });
  const samples = [
    { email: 'a@gmail.com' },
    { provider: 'google', email: 'a@gmail.com' },
    { provider: 'google', email: 'a@gmail.com', accountId: 'acc_1' },
    { provider: 'google', email: 'a@gmail.com', assertion: 'google-token' },
    { provider: 'apple', assertion: 'person@example.com', existingIdentityProof: 'proof-from-server' },
    { provider: 'google', assertion: 'google-token', existingIdentityProof: 'person@example.com' },
  ];
  for (const sample of samples) {
    await rejects(() => client.link(sample), 'EMAIL_ONLY_LINK_FORBIDDEN');
  }
  await rejects(
    () => client.link({ provider: 'google', assertion: 'google-token' }),
    'LINK_REJECTED',
  );
  await rejects(
    () => client.link({ provider: 'google', assertion: 'google-token', accountId: 'acc_1' }),
    'LINK_REJECTED',
  );
  assert.equal(requests.length, 0);
});

test('a server session can be read for Authorization and linking strips email', async () => {
  const { fetchImpl, requests } = recorder();
  const client = new WebFactory().create({ authEndpoint: ENDPOINT, fetchImpl });
  const session = await client.authenticate('google', {
    assertion: 'google-id-token',
    email: 'a@gmail.com',
  });
  assert.equal(session.origin, 'server');
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['assertion', 'provider']);
  assert.equal(client.getAccessToken(), 'opaque-server-token');
  assert.equal(client.getAuthorization(), 'Bearer opaque-server-token');

  const headers = [];
  await createAuthorizedFetch(session, async (_url, init) => {
    headers.push([...new Headers(init?.headers).entries()]);
    return new Response(null, { status: 204 });
  })('https://game.example.test/me');
  assert.deepEqual(headers, [[['authorization', 'Bearer opaque-server-token']]]);

  await rejects(
    () => client.link({ provider: 'apple', assertion: 'apple-token', email: 'a@gmail.com' }),
    'EMAIL_ONLY_LINK_FORBIDDEN',
  );
  assert.equal(requests.length, 1);

  const linked = await client.link({
    provider: 'apple',
    assertion: 'apple-identity-token',
    email: 'should-not-be-sent@example.com',
    session,
  });
  assert.equal(linked.accountId, 'acc_1');
  assert.equal(client.getAuthorization(), 'Bearer linked-token');
  assert.equal(requests[1].body.email, undefined);
  assert.equal(requests[1].body.mode, 'link');
  assert.equal(requests[1].body.accountId, 'acc_1');
  assert.equal(requests[1].body.assertion, 'apple-identity-token');
  assert.equal(requests[1].authorization, 'Bearer opaque-server-token');
  assert.equal(requests[1].contentType, 'application/json');

  await rejects(
    () => client.link({ provider: 'apple', assertion: 'open-new-account' }),
    'LINK_REJECTED',
  );
  assert.equal(client.getAccessToken(), 'linked-token');
  await rejects(
    () => client.link({
      provider: 'apple',
      assertion: 'apple-identity-token',
      session: JSON.parse(JSON.stringify(session)),
    }),
    'LINK_REJECTED',
  );
});

test('dual proof can link without a current session and still ignores email', async () => {
  const { fetchImpl, requests } = recorder();
  const client = new WebFactory().create({ authEndpoint: ENDPOINT, fetchImpl });
  const linked = await client.link({
    provider: 'apple',
    assertion: 'apple-identity-token',
    existingIdentityProof: 'proof-from-server',
    email: 'a@gmail.com',
  });
  assert.equal(linked.accountId, 'acc_1');
  assert.equal(requests[0].body.email, undefined);
  assert.equal(requests[0].body.existingIdentityProof, 'proof-from-server');
  assert.equal(requests[0].authorization, null);
});

test('the client refuses a session it did not receive from the server', async () => {
  const client = new AuthClient({
    environment: 'web',
    allowedPrimary: ['google'],
    lockPrimary: false,
  });
  client.register({
    id: 'google',
    async authenticate() {
      return {
        accountId: 'acc_1',
        token: 'opaque-server-token',
        expiresAt: '2099-01-01T00:00:00.000Z',
        identities: [{ provider: 'google', subject: 'google-sub' }],
        origin: 'server',
      };
    },
  });
  await rejects(() => client.authenticate('google', { assertion: 'google-token' }), 'INVALID_SESSION');
  assert.equal(client.getAccessToken(), null);
  assert.equal(client.getAuthorization(), null);
});

test('Telegram and Google adapters post to the server and do not mint sessions', async () => {
  const telegram = new TelegramIdentityAdapter();
  await rejects(() => telegram.authenticate({ initData: 'raw' }), 'NOT_IMPLEMENTED');
  await rejects(
    () => new TelegramIdentityAdapter({ botToken: '123456:not-a-real-token' }),
    'CLIENT_SECRET_FORBIDDEN',
  );

  const { fetchImpl, requests } = recorder();
  const client = new MiniAppFactory().create({ authEndpoint: ENDPOINT, fetchImpl });
  await client.authenticate('telegram', 'raw-init-data');
  assert.equal(requests[0].url, ENDPOINT);
  assert.deepEqual(requests[0].body, { provider: 'telegram', initData: 'raw-init-data' });

  const denied = new WebFactory().create({
    authEndpoint: ENDPOINT,
    fetchImpl: async () => new Response('no', { status: 401 }),
  });
  await rejects(() => denied.authenticate('google', { assertion: 'google-token' }), 'UNAUTHENTICATED');
  assert.equal(denied.getSession(), null);

  const emailedSubject = new WebFactory().create({
    authEndpoint: ENDPOINT,
    fetchImpl: async () => jsonResponse({
      accountId: 'acc_1',
      token: 'opaque-server-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      identities: [{ provider: 'google', subject: 'a@gmail.com' }],
    }),
  });
  await rejects(() => emailedSubject.authenticate('google', { assertion: 'google-token' }), 'INVALID_SESSION');
  assert.equal(emailedSubject.getSession(), null);

  const emailedAccount = new WebFactory().create({
    authEndpoint: ENDPOINT,
    fetchImpl: async () => jsonResponse({
      accountId: 'a@gmail.com',
      token: 'opaque-server-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      identities: [{ provider: 'google', subject: 'google-sub' }],
    }),
  });
  await rejects(() => emailedAccount.authenticate('google', { assertion: 'google-token' }), 'EMAIL_ONLY_LINK_FORBIDDEN');
  assert.equal(emailedAccount.getSession(), null);
});

test('link refuses a supplied session for a different account', async () => {
  const requests = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body);
    const accountId = body.assertion === 'client-b' ? 'acc_b' : 'acc_a';
    return jsonResponse({
      accountId,
      token: `token-${accountId}`,
      expiresAt: '2099-01-01T00:00:00.000Z',
      identities: [{ provider: body.provider, subject: `${accountId}-sub` }],
    });
  };
  const clientA = new WebFactory().create({ authEndpoint: ENDPOINT, fetchImpl });
  const clientB = new WebFactory().create({ authEndpoint: ENDPOINT, fetchImpl });
  const sessionA = await clientA.authenticate('google', { assertion: 'client-a' });
  await clientB.authenticate('google', { assertion: 'client-b' });
  const before = requests.length;
  await rejects(
    () => clientB.link({ provider: 'apple', assertion: 'apple-token', session: sessionA }),
    'LINK_REJECTED',
  );
  assert.equal(requests.length, before);
  assert.equal(clientB.getAccessToken(), 'token-acc_b');
  assert.equal(clientA.getAccessToken(), 'token-acc_a');
});

test('createAuthorizedFetch ignores a session the server did not issue', async () => {
  let authorization = 'unset';
  await createAuthorizedFetch({
    accountId: 'acc_1',
    token: 'forged-token',
    expiresAt: '2099-01-01T00:00:00.000Z',
    identities: [{ provider: 'google', subject: 'google-sub' }],
    origin: 'server',
  }, async (_url, init) => {
    authorization = new Headers(init?.headers).get('authorization');
    return new Response(null, { status: 204 });
  })('https://game.example.test/me');
  assert.equal(authorization, null);
});

test('a new provider can be registered on web without changing core', async () => {
  const client = new WebFactory().create();
  client.register(new TelegramIdentityAdapter(), { primary: true });
  assert.deepEqual(client.primaryProviders(), ['google', 'apple', 'telegram']);
  await rejects(() => client.authenticate('telegram', { initData: 'raw' }), 'NOT_IMPLEMENTED');
  assert.equal(client.getSession(), null);
});

test('the Telegram adapter does not verify HMAC in the browser package', () => {
  const source = readFileSync(new URL('../src/adapters/telegram.ts', import.meta.url), 'utf8');
  assert.equal(source.includes('createHmac'), false);
  assert.equal(source.includes('crypto.subtle'), false);
  assert.equal(source.includes('botToken'), false);
});
