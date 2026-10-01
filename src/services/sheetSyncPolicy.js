// A recovery batch holds the distributed Sheet lock while its rows are read, written, and
// verified. Keep the broad sweep small so concurrent scanners do not wait behind a long batch;
// failed scans use the one-order targeted queue below instead of waiting for this sweep.
export const SHEET_RECOVERY_MAX_ROWS = 3;
export const SHEET_RECOVERY_TARGETED_MAX_ROWS = 1;
export const SHEET_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
export const SHEET_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;
// A failed scan gets a small, single-order retry path. The regular ten-minute sweep remains
// the fallback for orders created while no app session was open.
export const SHEET_RECOVERY_TARGETED_RETRY_MS = 60 * 1000;

export function getSheetRecoveryBatchSize({ targeted = false } = {}) {
  return targeted ? SHEET_RECOVERY_TARGETED_MAX_ROWS : SHEET_RECOVERY_MAX_ROWS;
}

export function shouldApplySheetRecoveryCooldown({ showStatus = false, includeSynced = false, targeted = false } = {}) {
  // The ten-minute interval belongs to the background worker. A manual recovery must be able
  // to continue with the next bounded batch after a transient lock or quota failure.
  return !showStatus && !includeSynced && !targeted;
}

// Background browsers must serialize the claim and write phases behind the same distributed
// lock. Claiming first lets several browsers strand different rows as `pending` before they
// discover that only one of them can write the shared Sheet.
export function shouldPreflightSheetRecoveryLock({ showStatus = false, includeSynced = false, targeted = false } = {}) {
  return !showStatus && !includeSynced && !targeted;
}
