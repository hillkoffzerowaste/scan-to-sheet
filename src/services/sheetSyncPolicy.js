// A recovery row can require several reads/writes (including native-type verification).
// Ten rows every ten minutes keeps recovery useful without turning it into a quota burst.
export const SHEET_RECOVERY_MAX_ROWS = 10;
export const SHEET_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
export const SHEET_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;
// A failed scan gets a small, single-order retry path. The regular ten-minute sweep remains
// the fallback for orders created while no app session was open.
export const SHEET_RECOVERY_TARGETED_RETRY_MS = 60 * 1000;

export function shouldApplySheetRecoveryCooldown({ showStatus = false, includeSynced = false, targeted = false } = {}) {
  // The ten-minute interval belongs to the background worker. A manual recovery must be able
  // to continue with the next bounded batch after a transient lock or quota failure.
  return !showStatus && !includeSynced && !targeted;
}
