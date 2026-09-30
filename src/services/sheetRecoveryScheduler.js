import { SHEET_RECOVERY_INTERVAL_MS, SHEET_RECOVERY_TARGETED_RETRY_MS } from './sheetSyncPolicy.js';

// Use a completion-based timeout instead of setInterval. A recovery batch may take long
// enough that an interval tick lands inside the cooldown and silently skips the next batch.
export function createSheetRecoveryScheduler(task, {
  delayMs = SHEET_RECOVERY_INTERVAL_MS,
  runImmediately = false,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  let cancelled = false;
  let timerId = null;

  const run = async () => {
    if (cancelled) return;
    try {
      await task();
    } catch {
      // The recovery task reports its own errors. Always schedule the next attempt.
    }
    schedule();
  };

  const schedule = () => {
    if (cancelled) return;
    timerId = setTimeoutFn(() => {
      timerId = null;
      void run();
    }, delayMs);
  };

  if (runImmediately) void run();
  else schedule();

  return () => {
    cancelled = true;
    if (timerId !== null) clearTimeoutFn(timerId);
    timerId = null;
  };
}

// A failed scan should retry its own Firestore outbox entry without waiting for the broad
// ten-minute sweep. One timer is shared by the queued order ids, so a scan burst cannot create
// overlapping targeted recovery runs.
export function createSheetRecoveryRetryScheduler(task, {
  delayMs = SHEET_RECOVERY_TARGETED_RETRY_MS,
  setTimeoutFn = globalThis.setTimeout,
  clearTimeoutFn = globalThis.clearTimeout,
} = {}) {
  let cancelled = false;
  let timerId = null;
  let running = false;

  const schedule = () => {
    if (cancelled || running || timerId !== null) return;
    timerId = setTimeoutFn(async () => {
      timerId = null;
      if (cancelled) return;
      running = true;
      let retry = false;
      try {
        retry = (await task())?.retry === true;
      } catch {
        retry = true;
      } finally {
        running = false;
      }
      if (retry) schedule();
    }, delayMs);
  };

  const cancel = () => {
    cancelled = true;
    if (timerId !== null) clearTimeoutFn(timerId);
    timerId = null;
  };

  return { schedule, cancel };
}
