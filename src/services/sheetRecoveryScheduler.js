import { SHEET_RECOVERY_INTERVAL_MS } from './sheetSyncPolicy.js';

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
