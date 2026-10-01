export const SHEET_RECOVERY_QUEUE_STORAGE_KEY = 'scan-to-sheet-recovery-order-ids-v1';
const MAX_STORED_RECOVERY_IDS = 1000;

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((id) => typeof id === 'string')
    .map((id) => id.trim())
    .filter(Boolean))]
    .slice(0, MAX_STORED_RECOVERY_IDS);
}

export function loadSheetRecoveryOrderIds(storage = globalThis.localStorage) {
  try {
    return normalizeIds(JSON.parse(storage?.getItem(SHEET_RECOVERY_QUEUE_STORAGE_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function saveSheetRecoveryOrderIds(ids, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SHEET_RECOVERY_QUEUE_STORAGE_KEY, JSON.stringify(normalizeIds(ids)));
  } catch {
    // Firestore remains the durable recovery queue when browser storage is unavailable.
  }
}

export function addSheetRecoveryOrderId(orderId, storage = globalThis.localStorage) {
  const normalized = typeof orderId === 'string' ? orderId.trim() : '';
  if (!normalized) return loadSheetRecoveryOrderIds(storage);
  const ids = loadSheetRecoveryOrderIds(storage);
  if (!ids.includes(normalized)) ids.push(normalized);
  const next = normalizeIds(ids);
  saveSheetRecoveryOrderIds(next, storage);
  return next;
}

export function removeSheetRecoveryOrderId(orderId, storage = globalThis.localStorage) {
  const normalized = typeof orderId === 'string' ? orderId.trim() : '';
  const next = loadSheetRecoveryOrderIds(storage).filter((id) => id !== normalized);
  saveSheetRecoveryOrderIds(next, storage);
  return next;
}
