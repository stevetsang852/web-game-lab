import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptIceServers,
  generateIceServers,
  handleTurnRequest,
  usesBlockedBrowserPort,
} from './turn-credentials.mjs';

const KEY_ID = 'test-key-id';
const API_TOKEN = 'test-api-token';

test('drops browser-blocked port 53 and keeps public STUN beside provider URLs', () => {
  assert.equal(usesBlockedBrowserPort('turn:turn.example.test:53?transport=udp'), true);
  assert.equal(usesBlockedBrowserPort('stun:stun.example.test:53'), true);
  assert.equal(usesBlockedBrowserPort('turns:turn.example.test:443?transport=tcp'), false);

  const iceServers = adaptIceServers([
    {
      urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'],
    },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'short-user',
      credential: 'short-credential',
    },
  ]);

  const urls = iceServers.flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]));
  assert.equal(urls.some((url) => url.endsWith(':53') || url.includes(':53?')), false);
  assert.ok(urls.includes('stun:stun.cloudflare.com:3478'));
  assert.ok(urls.includes('stun:stun.l.google.com:19302'));
  assert.ok(urls.includes('turn:turn.cloudflare.com:3478?transport=udp'));
  assert.ok(urls.includes('turns:turn.cloudflare.com:443?transport=tcp'));
  assert.equal(iceServers.at(-1)?.username, 'short-user');
  assert.equal(iceServers.at(-1)?.credential, 'short-credential');
});

test('cloudflare provider posts the key id and ttl and returns standard iceServers', async () => {
  const calls = [];
  const iceServers = await generateIceServers(
    {
      TURN_PROVIDER: 'cloudflare',
      CF_TURN_KEY_ID: KEY_ID,
      CF_TURN_KEY_API_TOKEN: API_TOKEN,
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return Response.json({
          iceServers: [
            { urls: ['stun:stun.cloudflare.com:3478'] },
            {
              urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=tcp'],
              username: 'short-user',
              credential: 'short-credential',
            },
          ],
        }, { status: 201 });
      },
    },
  );

  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`,
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${API_TOKEN}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { ttl: 3600 });
  assert.equal(JSON.stringify(iceServers).includes(API_TOKEN), false);
  assert.equal(JSON.stringify(iceServers).includes(':53'), false);

  const response = await handleTurnRequest(
    new Request('https://demo.example.test/turn'),
    {
      CF_TURN_KEY_ID: `${KEY_ID}/extra`,
      CF_TURN_KEY_API_TOKEN: API_TOKEN,
      TURN_TTL_SECONDS: '7200',
    },
    {
      fetchImpl: async (url, init) => {
        assert.equal(
          url,
          'https://rtc.live.cloudflare.com/v1/turn/keys/test-key-id%2Fextra/credentials/generate-ice-servers',
        );
        assert.deepEqual(JSON.parse(init.body), { ttl: 7200 });
        return Response.json({
          iceServers: [{
            urls: ['turns:turn.example.test:443?transport=tcp'],
            username: 'short-user',
            credential: 'short-credential',
          }],
        }, { status: 201 });
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  const body = await response.json();
  assert.ok(Array.isArray(body.iceServers));
  assert.equal(JSON.stringify(body).includes(API_TOKEN), false);
});

test('missing configuration and reserved providers do not echo secrets', async () => {
  const missing = await handleTurnRequest(new Request('http://127.0.0.1/turn'), {
    TURN_PROVIDER: 'cloudflare',
    CF_TURN_KEY_ID: KEY_ID,
  });
  assert.equal(missing.status, 503);
  const missingBody = await missing.text();
  assert.equal(missingBody.includes(KEY_ID), false);
  assert.match(missingBody, /not configured/);

  for (const provider of ['metered', 'coturn']) {
    const reserved = await handleTurnRequest(new Request('http://127.0.0.1/turn/'), {
      TURN_PROVIDER: provider,
      CF_TURN_KEY_API_TOKEN: API_TOKEN,
    });
    assert.equal(reserved.status, 501);
    assert.equal((await reserved.text()).includes(API_TOKEN), false);
  }

  const unknown = await handleTurnRequest(new Request('http://127.0.0.1/web-game-lab/turn'), {
    TURN_PROVIDER: API_TOKEN,
    CF_TURN_KEY_API_TOKEN: API_TOKEN,
    CF_TURN_KEY_ID: KEY_ID,
  });
  assert.equal(unknown.status, 400);
  const unknownBody = await unknown.text();
  assert.equal(unknownBody.includes(API_TOKEN), false);
  assert.equal(unknownBody.includes(KEY_ID), false);
});

test('provider failures stay generic when Cloudflare echoes the token', async () => {
  const response = await handleTurnRequest(
    new Request('http://127.0.0.1/turn'),
    {
      CF_TURN_KEY_ID: KEY_ID,
      CF_TURN_KEY_API_TOKEN: API_TOKEN,
    },
    {
      fetchImpl: async () => Response.json({ error: `bad ${API_TOKEN}` }, { status: 401 }),
    },
  );
  assert.equal(response.status, 502);
  const text = await response.text();
  assert.equal(text.includes(API_TOKEN), false);
  assert.equal(text.includes(KEY_ID), false);

  const thrown = await handleTurnRequest(
    new Request('http://127.0.0.1/turn'),
    { CF_TURN_KEY_ID: KEY_ID, CF_TURN_KEY_API_TOKEN: API_TOKEN },
    {
      fetchImpl: async () => {
        throw new Error(`connect ${KEY_ID} Bearer ${API_TOKEN}`);
      },
    },
  );
  assert.equal(thrown.status, 502);
  assert.equal((await thrown.text()).includes(API_TOKEN), false);

  const badTtl = await handleTurnRequest(new Request('http://127.0.0.1/turn'), {
    CF_TURN_KEY_ID: KEY_ID,
    CF_TURN_KEY_API_TOKEN: API_TOKEN,
    TURN_TTL_SECONDS: '172801',
  });
  assert.equal(badTtl.status, 500);
});

test('GET /turn is the only success method and other paths are ignored', async () => {
  const post = await handleTurnRequest(new Request('http://127.0.0.1/turn', { method: 'POST' }), {});
  assert.equal(post.status, 405);
  const other = await handleTurnRequest(new Request('http://127.0.0.1/turnkey'), {});
  assert.equal(other, null);
  const options = await handleTurnRequest(new Request('http://127.0.0.1/turn', { method: 'OPTIONS' }), {});
  assert.equal(options.status, 204);
});
