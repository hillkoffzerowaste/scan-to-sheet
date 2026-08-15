import { PACKING_VIDEO_STATUS } from './packingVideoModel.js';

/**
 * The upload queue.
 *
 * Every dependency is injected so the whole state machine runs under `node --test` with no
 * browser: `db` stands in for IndexedDB, `pipeline` for the Storage/Firestore/Sheets work,
 * and `now` for the clock.
 *
 * The queue never blocks the packer. A clip is already durable in IndexedDB before it gets
 * here, so a failure at any step is a retry, never a lost recording.
 */

/** 5s → 30s → 2m → 10m → 30m. Long enough to ride out a warehouse Wi-Fi drop. */
export const UPLOAD_BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000];
export const MAX_UPLOAD_ATTEMPTS = 5;
/** How long a claimed job stays claimed, so a second tab cannot pick up the same upload. */
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export function uploadBackoffMs(attempts) {
  const index = Math.max(0, Math.floor(Number(attempts) || 0));
  return UPLOAD_BACKOFF_MS[Math.min(index, UPLOAD_BACKOFF_MS.length - 1)];
}

const RETRYABLE_STATUSES = [PACKING_VIDEO_STATUS.pendingUpload, PACKING_VIDEO_STATUS.cancelled];

/** A job is runnable when it still needs uploading, is not leased, and its backoff has elapsed. */
export function isRunnable(job, now) {
  if (!job || !RETRYABLE_STATUSES.includes(job.status)) return false;
  if (!job.blob) return false;
  if (Number(job.uploadAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS) return false;
  if (Number(job.leaseUntil ?? 0) > now) return false;
  return Number(job.nextAttemptAt ?? 0) <= now;
}

/** Oldest first, so a backlog drains in the order the parcels were packed. */
export function selectNextJob(jobs, { now }) {
  return (
    (jobs ?? [])
      .filter((job) => isRunnable(job, now))
      .sort((left, right) => Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0))[0] ?? null
  );
}

export function createPackingVideoQueue({
  db,
  pipeline,
  now = () => Date.now(),
  leaseMs = DEFAULT_LEASE_MS,
  onChange = () => {},
}) {
  if (!db || typeof pipeline !== 'function') {
    throw new TypeError('createPackingVideoQueue requires a db and a pipeline function');
  }

  // Guards against this tab's own loop double-starting a job; `leaseUntil` guards other tabs.
  const running = new Set();
  let draining = null;
  let disposed = false;

  async function notify() {
    if (disposed) return;
    try {
      onChange(await db.summarize());
    } catch {
      // A broken listener must not stall the queue.
    }
  }

  async function runJob(job) {
    const timestamp = now();
    running.add(job.videoId);
    await db.update(job.videoId, { leaseUntil: timestamp + leaseMs });

    try {
      const result = await pipeline(job);
      await db.update(job.videoId, {
        status: PACKING_VIDEO_STATUS.uploaded,
        storageUrl: result?.storageUrl ?? '',
        storagePath: result?.storagePath ?? job.storagePath ?? '',
        sheetStatus: result?.sheetStatus ?? 'pending',
        sheetRowNumber: result?.sheetRowNumber ?? 0,
        uploadedAt: timestamp,
        leaseUntil: 0,
        lastErrorCode: '',
      });
      // Only drop the recording once it is safely somewhere else.
      await db.dropBlob(job.videoId);
      return { videoId: job.videoId, status: 'uploaded' };
    } catch (error) {
      const attempts = Number(job.uploadAttempts ?? 0) + 1;
      const exhausted = attempts >= MAX_UPLOAD_ATTEMPTS;
      await db.update(job.videoId, {
        uploadAttempts: attempts,
        lastErrorCode: error?.code ?? 'PACKING_VIDEO_UPLOAD_FAILED',
        leaseUntil: 0,
        // A retry has to keep its file, so the blob is deliberately never dropped here.
        nextAttemptAt: exhausted ? 0 : timestamp + uploadBackoffMs(attempts),
        status: exhausted ? PACKING_VIDEO_STATUS.uploadFailed : job.status,
      });
      return { videoId: job.videoId, status: exhausted ? 'failed' : 'retry', error };
    } finally {
      running.delete(job.videoId);
    }
  }

  async function drain() {
    const results = [];
    while (!disposed) {
      const jobs = (await db.listPending()).filter((job) => !running.has(job.videoId));
      const job = selectNextJob(jobs, { now: now() });
      if (!job) break;
      results.push(await runJob(job));
      await notify();
    }
    draining = null;
    return results;
  }

  return {
    /** Starts a drain if one is not already running; safe to call on every trigger. */
    kick() {
      if (disposed) return Promise.resolve([]);
      draining ??= drain();
      return draining;
    },
    /**
     * Puts a failed clip back in line. Admin-triggered, which is why it clears the attempt
     * count instead of continuing the backoff.
     */
    async retry(videoId) {
      await db.update(videoId, {
        status: PACKING_VIDEO_STATUS.pendingUpload,
        uploadAttempts: 0,
        nextAttemptAt: 0,
        leaseUntil: 0,
        lastErrorCode: '',
      });
      await notify();
      return this.kick();
    },
    isRunning: (videoId) => running.has(videoId),
    dispose() {
      disposed = true;
      running.clear();
    },
  };
}
