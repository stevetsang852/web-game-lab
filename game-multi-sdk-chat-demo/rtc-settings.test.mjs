import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRtcConfiguration, explainConnectionError, resolveTurnEndpoint } from './src/rtc-settings.ts';

const empty = {
  stunUrls: '',
  turnUrls: '',
  turnUsername: '',
  turnCredential: '',
  relayOnly: false,
};

test('empty Advanced ICE installs public TURN instead of STUN-only', async () => {
  const nowMs = 1_700_000_000_000;
  const config = await createRtcConfiguration(empty, nowMs);
  assert.equal(config.iceTransportPolicy, 'all');
  const urls = config.iceServers.flatMap((server) =>
    Array.isArray(server.urls) ? server.urls : [server.urls]);
  assert.ok(urls.includes('stun:stun.l.google.com:19302'));
  assert.ok(urls.includes('turn:staticauth.openrelay.metered.ca:443'));
  assert.ok(urls.includes('turns:staticauth.openrelay.metered.ca:443?transport=tcp'));
  assert.equal(urls.some((url) => url.includes('turn.peerjs.com')), false);

  const staticServer = config.iceServers.find((server) => server.username === 'openrelayproject');
  assert.equal(staticServer?.credential, 'openrelayproject');

  const expiry = Math.floor(nowMs / 1000) + 6 * 60 * 60;
  const restUsername = `${expiry}:gmsdk`;
  const restServer = config.iceServers.find((server) => server.username === restUsername);
  const expected = createHmac('sha1', 'openrelayprojectsecret').update(restUsername).digest('base64');
  assert.equal(restServer?.credential, expected);
});

test('custom servers replace the built-in relay', async () => {
  const stunOnly = await createRtcConfiguration({
    ...empty,
    stunUrls: 'stun:stun.example.test:3478',
  });
  assert.deepEqual(stunOnly.iceServers, [{ urls: ['stun:stun.example.test:3478'] }]);

  const customTurn = await createRtcConfiguration({
    ...empty,
    turnUrls: 'turns:turn.example.test:443?transport=tcp',
    turnUsername: 'temp-user',
    turnCredential: 'temp-secret',
    relayOnly: true,
  });
  assert.equal(customTurn.iceTransportPolicy, 'relay');
  assert.deepEqual(customTurn.iceServers[1], {
    urls: ['turns:turn.example.test:443?transport=tcp'],
    username: 'temp-user',
    credential: 'temp-secret',
  });
  assert.equal(JSON.stringify(customTurn).includes('openrelay'), false);
});

test('rejects incomplete TURN input before connecting', async () => {
  await assert.rejects(
    createRtcConfiguration({ ...empty, relayOnly: true }),
    /Relay-only mode requires a TURN server/,
  );
  await assert.rejects(
    createRtcConfiguration({ ...empty, turnUsername: 'only-user' }),
    /TURN credentials require a TURN server URL/,
  );
  await assert.rejects(
    createRtcConfiguration({ ...empty, turnUrls: 'http://turn.example.test' }),
    /turn: or turns:/,
  );
});

test('empty Advanced ICE uses iceServers from /turn and drops port 53', async () => {
  const calls = [];
  const config = await createRtcConfiguration(empty, 1_700_000_000_000, {
    turnEndpoint: 'https://yin-game-lab.grok.me/turn',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({
        iceServers: [
          { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
          {
            urls: [
              'turn:turn.example.test:3478?transport=udp',
              'turn:turn.example.test:53?transport=udp',
              'turns:turn.example.test:443?transport=tcp',
            ],
            username: 'short-user',
            credential: 'short-credential',
          },
        ],
      });
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://yin-game-lab.grok.me/turn');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.cache, 'no-store');
  const urls = config.iceServers.flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]));
  assert.ok(urls.includes('turn:turn.example.test:3478?transport=udp'));
  assert.ok(urls.includes('turns:turn.example.test:443?transport=tcp'));
  assert.equal(urls.some((url) => url.includes(':53')), false);
  assert.equal(JSON.stringify(config).includes('openrelay'), false);
  assert.equal(JSON.stringify(config).includes('0.peerjs.com'), false);
  assert.equal(config.iceTransportPolicy, 'all');
});

test('failed /turn falls back to the public relay and manual URLs skip the fetch', async () => {
  let calls = 0;
  const fallback = await createRtcConfiguration(empty, 1_700_000_000_000, {
    turnEndpoint: 'https://turn.example.test/turn',
    fetchImpl: async () => {
      calls += 1;
      return new Response('missing', { status: 404, headers: { 'content-type': 'text/html' } });
    },
  });
  assert.equal(calls, 1);
  const urls = fallback.iceServers.flatMap((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]));
  assert.ok(urls.includes('turn:staticauth.openrelay.metered.ca:443'));

  calls = 0;
  await createRtcConfiguration({
    ...empty,
    turnUrls: 'turns:turn.example.test:443?transport=tcp',
    turnUsername: 'temp-user',
    turnCredential: 'temp-secret',
  }, 1_700_000_000_000, {
    turnEndpoint: 'https://turn.example.test/turn',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('should not fetch');
    },
  });
  assert.equal(calls, 0);
});

test('relay-only uses hosted TURN and rejects a STUN-only credential response', async () => {
  const relay = await createRtcConfiguration({ ...empty, relayOnly: true }, 1_700_000_000_000, {
    turnEndpoint: 'https://turn.example.test/turn',
    fetchImpl: async () => Response.json({
      iceServers: [{
        urls: ['turns:turn.example.test:443?transport=tcp'],
        username: 'short-user',
        credential: 'short-credential',
      }],
    }),
  });
  assert.equal(relay.iceTransportPolicy, 'relay');
  assert.equal(JSON.stringify(relay).includes('openrelay'), false);

  await assert.rejects(
    createRtcConfiguration({ ...empty, relayOnly: true }, 1_700_000_000_000, {
      turnEndpoint: 'https://turn.example.test/turn',
      fetchImpl: async () => Response.json({
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      }),
    }),
    /Relay-only mode requires a TURN server/,
  );
});

test('resolveTurnEndpoint stays relative to the page or an env base', () => {
  assert.equal(resolveTurnEndpoint({
    origin: 'https://yin-game-lab.grok.me',
    pageBase: '/',
  }), 'https://yin-game-lab.grok.me/turn');
  assert.equal(resolveTurnEndpoint({
    origin: 'https://stevetsang852.github.io',
    pageBase: '/web-game-lab/',
  }), 'https://stevetsang852.github.io/web-game-lab/turn');
  assert.equal(resolveTurnEndpoint({
    configuredBase: 'https://game-lab-turn.example.workers.dev/',
    origin: 'https://yin-game-lab.grok.me',
  }), 'https://game-lab-turn.example.workers.dev/turn');
  assert.equal(resolveTurnEndpoint({
    configuredBase: 'https://game-lab-turn.example.workers.dev/turn/',
  }), 'https://game-lab-turn.example.workers.dev/turn');
  assert.equal(resolveTurnEndpoint({ pageBase: '/' }), undefined);
});

test('client sources do not reference the Cloudflare credential API or its secrets', () => {
  const source = [
    'src/rtc-settings.ts',
    'src/ChatRoom.tsx',
    'src/main.tsx',
  ].map((file) => readFileSync(new URL(file, import.meta.url), 'utf8')).join('\n');
  assert.equal(source.includes('CF_TURN'), false);
  assert.equal(source.includes('rtc.live.cloudflare.com'), false);
  assert.equal(source.includes('generate-ice-servers'), false);
  assert.equal(source.includes('0.peerjs.com'), true);
});

test('data-channel open timeout mentions ICE, NAT, and Advanced TURN', () => {
  const mesh = explainConnectionError(
    'RTC mesh connection to "host-1" timed out before the data channel opened.',
  );
  assert.match(mesh, /timed out before the data channel opened/);
  assert.match(mesh, /ICE/);
  assert.match(mesh, /NAT/);
  assert.match(mesh, /Advanced WebRTC \/ TURN/);
  assert.match(mesh, /local PeerJS broker/);
  assert.match(mesh, /\/turn/);

  const star = explainConnectionError('RTC host data channel timed out before it opened.');
  assert.match(star, /Advanced WebRTC \/ TURN/);

  assert.equal(explainConnectionError('RTC host heartbeat timed out.'), 'RTC host heartbeat timed out.');
});
