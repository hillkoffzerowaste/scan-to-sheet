import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs } from './worker.js';

const argv = (...args) => ['node', 'worker.js', ...args];

test('defaults to a single pass', () => {
  const parsed = parseArgs(argv());
  assert.equal(parsed.watch, false);
  assert.equal(parsed.intervalSeconds, 60);
});

test('--watch turns on the loop and keeps the default interval', () => {
  assert.deepEqual(parseArgs(argv('--watch')), { watch: true, intervalSeconds: 60 });
});

test('--interval overrides the delay between passes', () => {
  assert.equal(parseArgs(argv('--watch', '--interval', '30')).intervalSeconds, 30);
});

test('rejects an interval below the floor', () => {
  // Each pass bills a Firestore query even when idle, so a too-small interval has to fail loudly
  // rather than quietly poll several times a second overnight.
  assert.throws(() => parseArgs(argv('--watch', '--interval', '1')), /interval/);
});

test('rejects a non-numeric interval', () => {
  assert.throws(() => parseArgs(argv('--watch', '--interval', 'soon')), /interval/);
  assert.throws(() => parseArgs(argv('--watch', '--interval')), /interval/);
});
