import test from 'node:test';
import assert from 'node:assert/strict';

import { createScanQueue } from './scanQueue.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert.fail('Timed out waiting for scan queue state');
}

test('accepts scans immediately and processes them in FIFO order', async () => {
  const first = deferred();
  const processed = [];
  const queue = createScanQueue({
    process: async (job) => {
      processed.push(job.code);
      if (job.code === 'A') await first.promise;
      return { status: 'success', code: job.code };
    },
  });

  assert.equal(queue.enqueue({ id: '1', code: 'A', context: {} }).accepted, true);
  assert.equal(queue.enqueue({ id: '2', code: 'B', context: {} }).accepted, true);
  assert.equal(queue.enqueue({ id: '3', code: 'C', context: {} }).accepted, true);
  assert.deepEqual(queue.getSnapshot().pending.map((job) => job.code), ['B', 'C']);

  first.resolve();
  await waitFor(() => queue.getSnapshot().completed === 3);

  assert.deepEqual(processed, ['A', 'B', 'C']);
  assert.equal(queue.getSnapshot().processing, null);
});

test('rejects a normalized duplicate while it is queued or processing', async () => {
  const gate = deferred();
  const queue = createScanQueue({ process: () => gate.promise });

  queue.enqueue({ id: '1', code: ' JT-123 ', context: {} });
  const duplicate = queue.enqueue({ id: '2', code: 'jt-123', context: {} });

  assert.deepEqual(duplicate, { accepted: false, reason: 'duplicate_pending', job: null });
  gate.resolve({ status: 'success' });
  await waitFor(() => queue.getSnapshot().completed === 1);
  assert.equal(queue.enqueue({ id: '3', code: 'JT-123', context: {} }).accepted, true);
});

test('counts the processing job toward capacity', () => {
  const queue = createScanQueue({ process: () => new Promise(() => {}), maxSize: 2 });

  queue.enqueue({ id: '1', code: 'A', context: {} });
  queue.enqueue({ id: '2', code: 'B', context: {} });

  assert.deepEqual(queue.enqueue({ id: '3', code: 'C', context: {} }), {
    accepted: false,
    reason: 'queue_full',
    job: null,
  });
});

test('continues with the next scan after a processing error', async () => {
  const processed = [];
  const queue = createScanQueue({
    process: async (job) => {
      processed.push(job.code);
      if (job.code === 'A') throw new Error('offline');
      return { status: 'success', code: job.code };
    },
  });

  queue.enqueue({ id: '1', code: 'A', context: {} });
  queue.enqueue({ id: '2', code: 'B', context: {} });
  await waitFor(() => queue.getSnapshot().completed === 2);

  assert.deepEqual(processed, ['A', 'B']);
  assert.equal(queue.getSnapshot().failed, 1);
  const failedResult = queue.getSnapshot().results.find((result) => result.status === 'error');
  assert.equal(failedResult.job.code, 'A');
  assert.equal(failedResult.error.message, 'offline');
});
