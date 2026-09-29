// A recovery row can require several reads/writes (including native-type verification).
// Ten rows every ten minutes keeps recovery useful without turning it into a quota burst.
export const SHEET_RECOVERY_MAX_ROWS = 10;
export const SHEET_RECOVERY_INTERVAL_MS = 10 * 60 * 1000;
export const SHEET_RECOVERY_COOLDOWN_MS = 10 * 60 * 1000;
