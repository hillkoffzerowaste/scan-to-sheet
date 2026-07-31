export const SHEET_SYNC_STALE_MS = 2 * 60 * 1000;

export function isSheetSyncClaimable(order, now = Date.now()) {
  if (!order || order.sheetSyncStatus === 'synced') return false;
  if (order.sheetSyncStatus === 'failed' || !order.sheetSyncStatus) return true;
  const startedAt = new Date(order.sheetSyncStartedAtIso ?? 0).getTime();
  return !Number.isFinite(startedAt) || now - startedAt >= SHEET_SYNC_STALE_MS;
}

export function shouldReconcileSheetOnRescan(order, scanType) {
  return Boolean(
    order?.[scanType]?.scannedAt
    && order.sheetSyncStatus !== 'synced',
  );
}

export function prioritizeSheetSyncCandidates({ failed = [], pending = [], maxRows = 20 }) {
  return [...failed, ...pending].slice(0, Math.max(0, maxRows));
}

export function buildSheetSyncFailureUpdates(orders = [], error = null) {
  const message = String(error?.message ?? error ?? 'Unknown sync error');
  return orders.map((order) => ({
    orderId: order.id,
    attemptId: order.sheetSyncAttemptId ?? '',
    error: new Error(message),
  }));
}

export function shouldIncludeInManualSheetRecovery(order, role = 'both') {
  if (!order || !(order.code || order.normalizedCode)) return false;
  const hasPacker = Boolean(order.packerScan?.scannedAt);
  const hasAdmin = Boolean(order.admin?.scannedAt);
  if (role === 'packer') return hasPacker;
  if (role === 'admin') return hasAdmin;
  return hasPacker || hasAdmin;
}
