import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createRtcConfiguration, explainConnectionError } from './src/rtc-settings.ts';

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

test('data-channel open timeout mentions ICE, NAT, and Advanced TURN', () => {
  const mesh = explainConnectionError(
    'RTC mesh connection to "host-1" timed out before the data channel opened.',
  );
  assert.match(mesh, /timed out before the data channel opened/);
  assert.match(mesh, /ICE/);
  assert.match(mesh, /NAT/);
  assert.match(mesh, /Advanced WebRTC \/ TURN/);
  assert.match(mesh, /local PeerJS broker/);

  const star = explainConnectionError('RTC host data channel timed out before it opened.');
  assert.match(star, /Advanced WebRTC \/ TURN/);

  assert.equal(explainConnectionError('RTC host heartbeat timed out.'), 'RTC host heartbeat timed out.');
});
