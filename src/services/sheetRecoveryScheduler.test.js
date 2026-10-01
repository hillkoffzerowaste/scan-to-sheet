import assert from 'node:assert/strict';
import test from 'node:test';

import { SHEET_RECOVERY_INTERVAL_MS, SHEET_RECOVERY_TARGETED_RETRY_MS } from './sheetSyncPolicy.js';
import { createSheetRecoveryRetryScheduler, createSheetRecoveryScheduler } from './sheetRecoveryScheduler.js';

function fakeTimers() {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimeout(task, delay) {
      const id = ++nextId;
      timers.set(id, { task, delay });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    get(id) {
      return timers.get(id);
    },
    get size() {
      return timers.size;
    },
    async run(id) {
      const timer = timers.get(id);
      timers.delete(id);
      return timer?.task();
    },
  };
}

test('schedules the next recovery interval after the previous batch finishes', async () => {
  const timers = fakeTimers();
  let releaseFirstRun;
  let runs = 0;
  const firstRun = new Promise((resolve) => { releaseFirstRun = resolve; });
  const scheduler = createSheetRecoveryScheduler(async () => {
    runs += 1;
    if (runs === 1) await firstRun;
  }, {
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  const running = timers.run(1);
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(timers.size, 0);

  releaseFirstRun();
  await running;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers.size, 1);
  assert.equal(timers.get(2).delay, SHEET_RECOVERY_INTERVAL_MS);

  scheduler();
});

test('retries a background batch soon when another recovery is already running', async () => {
  const timers = fakeTimers();
  let runs = 0;
  const scheduler = createSheetRecoveryScheduler(async () => {
    runs += 1;
    return { busy: runs === 1 };
  }, {
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await timers.run(1);
  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(timers.get(2).delay, SHEET_RECOVERY_TARGETED_RETRY_MS);

  await timers.run(2);
  await Promise.resolve();
  assert.equal(runs, 2);
  assert.equal(timers.get(3).delay, SHEET_RECOVERY_INTERVAL_MS);

  scheduler();
});

test('honors a recovery retry delay returned by the task', async () => {
  const timers = fakeTimers();
  const scheduler = createSheetRecoveryScheduler(async () => ({ retryAfterMs: 3_000 }), {
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await timers.run(1);
  await Promise.resolve();
  assert.equal(timers.get(2).delay, 3_000);

  scheduler();
});

test('automatically retries a failed targeted recovery without overlapping timers', async () => {
  const timers = fakeTimers();
  const attempts = [];
  const scheduler = createSheetRecoveryRetryScheduler(async () => {
    attempts.push('run');
    return { retry: attempts.length === 1 };
  }, {
    delayMs: 60_000,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  scheduler.schedule();
  scheduler.schedule();
  assert.equal(timers.size, 1);
  assert.equal(timers.get(1).delay, 60_000);

  await timers.run(1);
  await Promise.resolve();
  assert.deepEqual(attempts, ['run']);
  assert.equal(timers.size, 1);
  assert.equal(timers.get(2).delay, 60_000);

  await timers.run(2);
  await Promise.resolve();
  assert.deepEqual(attempts, ['run', 'run']);
  assert.equal(timers.size, 0);

  scheduler.cancel();
});

test('cancels a pending recovery without scheduling another batch', async () => {
  const timers = fakeTimers();
  let runs = 0;
  const scheduler = createSheetRecoveryScheduler(async () => { runs += 1; }, {
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  scheduler();
  assert.equal(timers.size, 0);
  assert.equal(runs, 0);
});

test('can run the first recovery immediately without creating a second timer', async () => {
  const timers = fakeTimers();
  let runs = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const scheduler = createSheetRecoveryScheduler(async () => {
    runs += 1;
    await blocked;
  }, {
    runImmediately: true,
    setTimeoutFn: timers.setTimeout,
    clearTimeoutFn: timers.clearTimeout,
  });

  await Promise.resolve();
  assert.equal(runs, 1);
  assert.equal(timers.size, 0);

  release();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(timers.size, 1);
  scheduler();
});
