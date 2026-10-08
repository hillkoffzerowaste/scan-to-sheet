const MIN_RETRY_DELAY_MS = 250;
const MAX_EXPONENTIAL_DELAY_MS = 2_000;

// A lock can legitimately be held while another batch reads and confirms a Sheet row.
// Keep retrying for roughly the old 20-second window, but avoid hammering the distributed lock every 250ms.
export const SHEET_LOCK_MAX_ATTEMPTS = 12;
// Background recovery is already scheduled again after a failed batch. One lock
// attempt per batch avoids every open browser polling the shared lock in parallel.
export const SHEET_LOCK_BACKGROUND_MAX_ATTEMPTS = 1;

export function getSheetLockRetryDelay(attempt, serverRetryAfterMs = MIN_RETRY_DELAY_MS) {
  const normalizedAttempt = Number.isFinite(Number(attempt))
    ? Math.max(0, Math.floor(Number(attempt)))
    : 0;
  const serverDelay = Number.isFinite(Number(serverRetryAfterMs))
    ? Math.max(MIN_RETRY_DELAY_MS, Number(serverRetryAfterMs))
    : MIN_RETRY_DELAY_MS;
  const exponentialDelay = Math.min(
    MAX_EXPONENTIAL_DELAY_MS,
    MIN_RETRY_DELAY_MS * (2 ** Math.min(normalizedAttempt, 3)),
  );
  return Math.max(exponentialDelay, serverDelay);
}
