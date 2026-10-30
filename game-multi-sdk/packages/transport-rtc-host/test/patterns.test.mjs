/**
 * Basic unit tests for design-pattern foundations.
 * Run with: node --test test/patterns.test.mjs
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DefaultConnectionStateMachine } from '../dist/patterns/ConnectionStateMachine.js';
import { EventBus } from '../dist/patterns/EventBus.js';

test('ConnectionStateMachine rejects illegal transitions', () => {
  const sm = new DefaultConnectionStateMachine();
  assert.equal(sm.state, 'idle');
  assert.equal(sm.canTransition('signaling'), true);
  assert.equal(sm.canTransition('connected'), false);
  sm.transition('signaling');
  assert.equal(sm.state, 'signaling');
  assert.throws(() => sm.transition('idle'), /Invalid connection state transition/);
});

test('ConnectionStateMachine notifies listeners', () => {
  const sm = new DefaultConnectionStateMachine();
  const seen = [];
  sm.onTransition((from, to) => seen.push(`${from}->${to}`));
  sm.transition('signaling');
  sm.transition('connecting');
  sm.transition('connected');
  assert.deepEqual(seen, ['idle->signaling', 'signaling->connecting', 'connecting->connected']);
});

test('EventBus delivers and unsubscribes', () => {
  const bus = new EventBus();
  const got = [];
  const off = bus.on('ping', (n) => got.push(n));
  bus.emit('ping', 1);
  bus.emit('ping', 2);
  off();
  bus.emit('ping', 3);
  assert.deepEqual(got, [1, 2]);
});
