import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ErrorCodes,
  LAB_ENVIRONMENTS,
  Observer,
  ProviderRegistry,
  SdkError,
  err,
  isOk,
  ok,
  rejectClientSecrets,
} from '../dist/index.js';

test('Result distinguishes success from a typed error', () => {
  const success = ok('session');
  const failure = err(new SdkError(ErrorCodes.NotImplemented, 'skeleton'));
  assert.equal(isOk(success), true);
  if (success.ok) assert.equal(success.value, 'session');
  assert.equal(failure.ok, false);
  if (!failure.ok) assert.equal(failure.error.code, 'NOT_IMPLEMENTED');
});

test('registry accepts a new provider without a core change', () => {
  const registry = new ProviderRegistry();
  registry.register({ id: 'custom-provider' });
  assert.equal(registry.require('custom-provider').id, 'custom-provider');
  assert.equal(registry.tryGet('missing').ok, false);
  assert.throws(
    () => registry.register({ id: 'custom-provider' }),
    (error) => error instanceof SdkError && error.code === ErrorCodes.ProviderAlreadyRegistered,
  );
});

test('observer notifies subscribers and stops after unsubscribe', () => {
  const events = new Observer();
  const seen = [];
  const stop = events.subscribe((value) => seen.push(value));
  events.notify('INVOICE_OPEN');
  stop();
  events.notify('PAID');
  assert.deepEqual(seen, ['INVOICE_OPEN']);
});

test('one observer listener cannot block the others', () => {
  const events = new Observer();
  const seen = [];
  events.subscribe(() => {
    throw new Error('listener failed');
  });
  events.subscribe((value) => seen.push(value));
  assert.doesNotThrow(() => events.notify('INVOICE_OPEN'));
  assert.deepEqual(seen, ['INVOICE_OPEN']);
});

test('client option bags cannot carry provider secrets', () => {
  assert.doesNotThrow(() => rejectClientSecrets({ authEndpoint: 'https://auth.example.test/session' }));
  assert.throws(
    () => rejectClientSecrets({ botToken: '123456:not-a-real-token' }),
    (error) => error instanceof SdkError && error.code === ErrorCodes.ClientSecretForbidden,
  );
});

test('environment names are mini app, web, and native', () => {
  assert.deepEqual([...LAB_ENVIRONMENTS], ['mini_app', 'web', 'native']);
});
