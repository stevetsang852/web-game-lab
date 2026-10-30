import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRtcConfiguration } from '../dist/rtc-configuration.js';

test('preserves PeerJS defaults when no RTC configuration is provided', () => {
  assert.equal(resolveRtcConfiguration({}), undefined);
});

test('supports the legacy iceServers shorthand including TURN credentials', () => {
  const iceServers = [{
    urls: ['turn:turn.example.test:3478', 'turns:turn.example.test:443?transport=tcp'],
    username: 'temporary-user',
    credential: 'temporary-credential',
  }];
  assert.deepEqual(resolveRtcConfiguration({ iceServers }), { iceServers });
});

test('preserves full RTCConfiguration settings without mutating caller options', () => {
  const rtcConfiguration = Object.freeze({
    iceServers: [{ urls: 'turns:turn.example.test:443', username: 'user', credential: 'token' }],
    iceTransportPolicy: 'relay',
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
    iceCandidatePoolSize: 2,
  });
  const resolved = resolveRtcConfiguration({ rtcConfiguration });
  assert.deepEqual(resolved, rtcConfiguration);
  assert.notEqual(resolved, rtcConfiguration);
});

test('explicit configuration servers take precedence over the legacy shorthand', () => {
  const iceServers = [{ urls: 'stun:legacy.example.test:3478' }];
  const configuredServers = [{ urls: 'turn:custom.example.test:3478', username: 'user', credential: 'token' }];
  assert.deepEqual(resolveRtcConfiguration({
    iceServers,
    rtcConfiguration: { iceServers: configuredServers, iceTransportPolicy: 'relay' },
  }), { iceServers: configuredServers, iceTransportPolicy: 'relay' });
});

test('combines other RTC options with legacy servers but respects an explicit empty list', () => {
  const iceServers = [{ urls: 'stun:legacy.example.test:3478' }];
  assert.deepEqual(resolveRtcConfiguration({
    iceServers,
    rtcConfiguration: { iceTransportPolicy: 'all' },
  }), { iceServers, iceTransportPolicy: 'all' });
  assert.deepEqual(resolveRtcConfiguration({
    iceServers,
    rtcConfiguration: { iceServers: [] },
  }), { iceServers: [] });
});
