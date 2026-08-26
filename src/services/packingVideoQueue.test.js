import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_UPLOAD_ATTEMPTS,
  UPLOAD_BACKOFF_MS,
  createPackingVideoQueue,
  isRunnable,
  selectNextJob,
  uploadBackoffMs,
} from './packingVideoQueue.js';

/** Minimal stand-in for the IndexedDB wrapper. */
function fakeDb(initial = []) {
  const rows = new Map(initial.map((row) => [row.videoId, { ...row }]));
  return {
    rows,
    // Mirrors listPendingVideos, which returns only rows that still hold a blob. A fake that
    // returned everything would let a guard pass in tests and miss in production.
    listPending: async () => [...rows.values()].filter((row) => row.blob).map((row) => ({ ...row })),
    get: async (videoId) => (rows.has(videoId) ? { ...rows.get(videoId) } : null),
    update: async (videoId, patch) => {
      rows.set(videoId, { ...rows.get(videoId), ...patch });
    },
    dropBlob: async (videoId) => {
      rows.set(videoId, { ...rows.get(videoId), blob: null });
    },
    summarize: async () => ({ pending: [...rows.values()].filter((row) => row.blob).length }),
  };
}

const job = (overrides = {}) => ({
  videoId: 'pv_1',
  status: 'pending_upload',
  blob: 'BLOB',
  uploadAttempts: 0,
  nextAttemptAt: 0,
  leaseUntil: 0,
  createdAt: 1,
  ...overrides,
});

test('backoff climbs then holds at the longest wait', () => {
  assert.equal(uploadBackoffMs(1), UPLOAD_BACKOFF_MS[1]);
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(uploadBackoffMs),
    UPLOAD_BACKOFF_MS,
  );
  assert.equal(uploadBackoffMs(99), UPLOAD_BACKOFF_MS.at(-1));
});

test('an already uploaded clip is never picked up again', () => {
  assert.equal(isRunnable(job({ status: 'uploaded' }), 100), false);
  assert.equal(isRunnable(job({ status: 'upload_failed' }), 100), false);
  assert.equal(isRunnable(job(), 100), true);
});

test('a clip whose blob is gone is not runnable', () => {
  assert.equal(isRunnable(job({ blob: null }), 100), false);
});

test('a job still under lease is skipped so two tabs cannot upload it twice', () => {
  assert.equal(isRunnable(job({ leaseUntil: 500 }), 100), false);
  assert.equal(isRunnable(job({ leaseUntil: 500 }), 600), true);
});

test('a job waiting out its backoff is skipped until the time arrives', () => {
  assert.equal(isRunnable(job({ nextAttemptAt: 500 }), 100), false);
  assert.equal(isRunnable(job({ nextAttemptAt: 500 }), 500), true);
});

test('the oldest runnable job goes first', () => {
  const next = selectNextJob(
    [job({ videoId: 'new', createdAt: 30 }), job({ videoId: 'old', createdAt: 10 })],
    { now: 100 },
  );
  assert.equal(next.videoId, 'old');
  assert.equal(selectNextJob([], { now: 100 }), null);
});

test('a successful upload records the result and only then drops the blob', async () => {
  const db = fakeDb([job()]);
  const queue = createPackingVideoQueue({
    db,
    now: () => 1000,
    pipeline: async () => ({ storageUrl: 'https://example/1', storagePath: 'p/1', sheetStatus: 'written', sheetRowNumber: 7 }),
  });

  assert.deepEqual(await queue.kick(), [{ videoId: 'pv_1', status: 'uploaded' }]);
  const stored = db.rows.get('pv_1');
  assert.equal(stored.status, 'uploaded');
  assert.equal(stored.storageUrl, 'https://example/1');
  assert.equal(stored.sheetRowNumber, 7);
  assert.equal(stored.uploadedAt, 1000);
  assert.equal(stored.blob, null);
});

test('a failed upload keeps the blob and schedules a retry', async () => {
  const db = fakeDb([job()]);
  const queue = createPackingVideoQueue({
    db,
    now: () => 1000,
    pipeline: async () => {
      throw Object.assign(new Error('offline'), { code: 'PACKING_VIDEO_UPLOAD_NETWORK' });
    },
  });

  const results = await queue.kick();
  assert.equal(results[0].status, 'retry');
  const stored = db.rows.get('pv_1');
  // Losing the file on a transient failure would destroy the evidence the feature exists for.
  assert.equal(stored.blob, 'BLOB');
  assert.equal(stored.uploadAttempts, 1);
  assert.equal(stored.status, 'pending_upload');
  assert.equal(stored.lastErrorCode, 'PACKING_VIDEO_UPLOAD_NETWORK');
  assert.equal(stored.nextAttemptAt, 1000 + UPLOAD_BACKOFF_MS[1]);
});

test('the queue gives up after the attempt ceiling but still keeps the file', async () => {
  const db = fakeDb([job({ uploadAttempts: MAX_UPLOAD_ATTEMPTS - 1 })]);
  const queue = createPackingVideoQueue({
    db,
    now: () => 1000,
    pipeline: async () => { throw new Error('nope'); },
  });

  const results = await queue.kick();
  assert.equal(results[0].status, 'failed');
  const stored = db.rows.get('pv_1');
  assert.equal(stored.status, 'upload_failed');
  assert.equal(stored.blob, 'BLOB');
  assert.equal(stored.uploadAttempts, MAX_UPLOAD_ATTEMPTS);
});

test('a job at the ceiling is not retried automatically', async () => {
  const db = fakeDb([job({ uploadAttempts: MAX_UPLOAD_ATTEMPTS })]);
  let calls = 0;
  const queue = createPackingVideoQueue({ db, now: () => 1000, pipeline: async () => { calls += 1; } });

  assert.deepEqual(await queue.kick(), []);
  assert.equal(calls, 0);
});

test('an Admin retry clears the attempt count and runs again', async () => {
  const db = fakeDb([job({ status: 'upload_failed', uploadAttempts: MAX_UPLOAD_ATTEMPTS, nextAttemptAt: 999_999 })]);
  const queue = createPackingVideoQueue({ db, now: () => 1000, pipeline: async () => ({ storageUrl: 'u' }) });

  await queue.retry('pv_1');
  const stored = db.rows.get('pv_1');
  assert.equal(stored.status, 'uploaded');
  assert.equal(stored.uploadAttempts, 0);
});

test('the queue drains every runnable job in one kick', async () => {
  const db = fakeDb([job({ videoId: 'a', createdAt: 1 }), job({ videoId: 'b', createdAt: 2 })]);
  const seen = [];
  const queue = createPackingVideoQueue({
    db,
    now: () => 1000,
    pipeline: async (item) => { seen.push(item.videoId); return { storageUrl: 'u' }; },
  });

  await queue.kick();
  assert.deepEqual(seen, ['a', 'b']);
});

test('a clip parked in review is not uploaded on its own, but can be released', async () => {
  // The whole point of needs_review: a defective clip must not drift into the archive by
  // itself. It must still be releasable, or the footage is stuck in IndexedDB until
  // purgeOldMetadata eventually drops the row.
  const db = fakeDb([job({ status: 'needs_review' })]);
  let uploads = 0;
  const queue = createPackingVideoQueue({
    db,
    now: () => 1000,
    pipeline: async () => { uploads += 1; return { storageUrl: 'u' }; },
  });

  assert.deepEqual(await queue.kick(), []);
  assert.equal(uploads, 0);
  assert.equal(db.rows.get('pv_1').status, 'needs_review');

  await queue.retry('pv_1');
  assert.equal(uploads, 1);
  assert.equal(db.rows.get('pv_1').status, 'uploaded');
  assert.equal(db.rows.get('pv_1').blob, null);
});

test('releasing a reviewed clip keeps the note that says why it was flagged', async () => {
  // The status becomes 'uploaded' like any other clip, so `note` is the only thing left saying
  // the footage has a hole in it — and it is what reaches Firestore and the sheet.
  const note = 'วิดีโอไม่สมบูรณ์: เขียนลงเครื่องไม่ครบทุกช่วง';
  const db = fakeDb([job({ status: 'needs_review', note })]);
  let seenNote = '';
  const queue = createPackingVideoQueue({
    db,
    now: () => 1000,
    pipeline: async (item) => { seenNote = item.note; return { storageUrl: 'u' }; },
  });

  await queue.retry('pv_1');
  assert.equal(seenNote, note);
  assert.equal(db.rows.get('pv_1').note, note);
});

test('a transient store failure does not kill the queue for good', async () => {
  // kick() memoises the drain promise. Without a finally the rejected promise stayed cached,
  // so one failed listPending() meant every later kick returned that same rejection and no
  // clip was ever uploaded again for the life of the tab.
  const db = fakeDb([job()]);
  let failNext = true;
  const listPending = db.listPending;
  db.listPending = async () => {
    if (failNext) {
      failNext = false;
      throw new Error('IndexedDB unavailable');
    }
    return listPending();
  };

  const queue = createPackingVideoQueue({ db, now: () => 1000, pipeline: async () => ({ storageUrl: 'u' }) });
  assert.deepEqual(await queue.kick(), []);

  const results = await queue.kick();
  assert.equal(results[0].status, 'uploaded');
  assert.equal(db.rows.get('pv_1').status, 'uploaded');
});

test('backoff is measured from when the attempt failed, not when it started', async () => {
  // A slow upload spent most of its own backoff before the retry was scheduled, so a clip that
  // timed out after minutes came straight back instead of waiting out the network problem.
  const db = fakeDb([job()]);
  const clock = [1_000, 601_000, 601_000];
  let tick = 0;
  const queue = createPackingVideoQueue({
    db,
    now: () => clock[Math.min(tick++, clock.length - 1)],
    pipeline: async () => { throw new Error('timeout'); },
  });

  await queue.kick();
  const stored = db.rows.get('pv_1');
  assert.equal(stored.nextAttemptAt, 601_000 + UPLOAD_BACKOFF_MS[1]);
});

test('a disposed queue stops accepting work', async () => {
  const db = fakeDb([job()]);
  let calls = 0;
  const queue = createPackingVideoQueue({ db, now: () => 1000, pipeline: async () => { calls += 1; } });
  queue.dispose();
  assert.deepEqual(await queue.kick(), []);
  assert.equal(calls, 0);
});

test('the queue refuses to be built without its dependencies', () => {
  assert.throws(() => createPackingVideoQueue({ db: null, pipeline: () => {} }), TypeError);
  assert.throws(() => createPackingVideoQueue({ db: {}, pipeline: null }), TypeError);
});

test('re-queueing a clip the queue already finished is refused', async () => {
  // canTransition existed but was enforced nowhere, so the table drifted from the code and an
  // uploaded clip could be sent round again — rewriting its Firestore document with a job that
  // no longer has a blob.
  const db = fakeDb([job({ status: 'uploaded', blob: null })]);
  let calls = 0;
  const queue = createPackingVideoQueue({ db, now: () => 1000, pipeline: async () => { calls += 1; } });

  await assert.rejects(
    () => queue.retry('pv_1'),
    (error) => error.code === 'PACKING_VIDEO_INVALID_TRANSITION',
  );
  assert.equal(calls, 0);
  assert.equal(db.rows.get('pv_1').status, 'uploaded');
});

test('a cancelled pack still uploads its clip', async () => {
  // "Cancelled" is a status, not a removal: the evidence is kept either way, which is why
  // isRunnable treats it as runnable. The transition table used to contradict that.
  const db = fakeDb([job({ status: 'cancelled' })]);
  const queue = createPackingVideoQueue({ db, now: () => 1000, pipeline: async () => ({ storageUrl: 'u' }) });

  const results = await queue.kick();
  assert.equal(results[0].status, 'uploaded');
  assert.equal(db.rows.get('pv_1').status, 'uploaded');
});
