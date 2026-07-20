export const SHEET_SYNC_STALE_MS = 2 * 60 * 1000;

export function isSheetSyncClaimable(order, now = Date.now()) {
  if (!order || order.sheetSyncStatus === 'synced') return false;
  if (order.sheetSyncStatus === 'failed' || !order.sheetSyncStatus) return true;
  const startedAt = new Date(order.sheetSyncStartedAtIso ?? 0).getTime();
  return !Number.isFinite(startedAt) || now - startedAt >= SHEET_SYNC_STALE_MS;
}
