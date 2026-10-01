import { userErrorMessage } from './authErrors.js';
import { SHEET_RECOVERY_MAX_ROWS } from './sheetSyncPolicy.js';

export const SHEET_SYNC_STALE_MS = 2 * 60 * 1000;

// `synced` is retained only for documents written before the outbox rollout.
// New work always reaches `verified` after the corresponding Sheet row is read back.
export const SHEET_SYNC_STATES = Object.freeze({
  PENDING: 'pending',
  WRITING: 'writing',
  VERIFIED: 'verified',
  FAILED: 'failed',
  LEGACY_SYNCED: 'synced',
});

const RETRYABLE_SHEET_SYNC_CODES = new Set([
  'GOOGLE_RATE_LIMITED',
  'GOOGLE_TIMEOUT',
  'SHEET_LOCK_BUSY',
  'SHEET_RATE_LIMIT_UNAVAILABLE',
  'SHEET_RECOVERY_UNCONFIRMED',
  'SHEET_BATCH_INCOMPLETE',
]);

export function isRetryableSheetSyncError(error) {
  const code = String(error?.code ?? '');
  if (RETRYABLE_SHEET_SYNC_CODES.has(code)) return true;
  if (error?.batchIncomplete === true) return true;
  if ([408, 409, 425, 429].includes(Number(error?.status)) || Number(error?.status) >= 500) return true;
  const diagnostic = [error?.message, error?.detail, error?.cause]
    .map((value) => typeof value === 'string' ? value : JSON.stringify(value ?? ''))
    .join(' ');
  return /เชื่อมต่อนานเกินไป|Google Sheet กำลังถูกใช้งาน|Google ตอบสนองช้า|Google จำกัดการเรียกใช้|rateLimitExceeded|userRateLimitExceeded|quotaExceeded|resource_exhausted|backendError|temporarilyUnavailable/i.test(diagnostic);
}

export function isSheetSyncVerified(order) {
  return ['verified', 'synced'].includes(order?.sheetSyncStatus);
}

export function summarizeSheetSyncOrders(orders = []) {
  const unsynced = orders.filter((order) => !isSheetSyncVerified(order));
  const failed = unsynced.filter((order) => order?.sheetSyncStatus === 'failed');
  return {
    pendingCount: unsynced.length,
    failedCount: failed.length,
    pendingOrderIds: unsynced.map((order) => order?.id).filter(Boolean),
    failedOrderIds: failed.map((order) => order?.id).filter(Boolean),
  };
}

export function requireSheetSyncAcknowledgement(acknowledged) {
  if (acknowledged !== true) {
    throw Object.assign(new Error('ยังยืนยันสถานะซิงก์ใน Firestore ไม่ได้ กรุณาตรวจและกู้คืนอีกครั้ง'), {
      code: 'SHEET_SYNC_NOT_ACKNOWLEDGED',
    });
  }
  return true;
}

export function canApplySheetSyncResult(current, { attemptId = '', ok }) {
  if (!current || String(current.sheetSyncAttemptId ?? '') !== String(attemptId ?? '')) return false;
  return ok || !isSheetSyncVerified(current);
}

export function isSheetSyncClaimable(order, now = Date.now()) {
  if (!order || isSheetSyncVerified(order)) return false;
  if (order.sheetSyncStatus === 'failed' || !order.sheetSyncStatus) return true;
  const startedAt = new Date(order.sheetSyncStartedAtIso ?? 0).getTime();
  return !Number.isFinite(startedAt) || now - startedAt >= SHEET_SYNC_STALE_MS;
}

export function shouldKeepTargetedSheetRecovery(order, now = Date.now()) {
  return Boolean(order && !isSheetSyncVerified(order) && !isSheetSyncClaimable(order, now));
}

export function shouldReconcileSheetOnRescan(order, scanType) {
  return Boolean(
    order?.[scanType]?.scannedAt
    && !isSheetSyncVerified(order),
  );
}

export function prioritizeSheetSyncCandidates({ failed = [], pending = [], maxRows = Infinity }) {
  return [...failed, ...pending].slice(0, Math.max(0, maxRows));
}

// Keep failed work first, then drain the oldest pending work before newer scans can
// continually push an older retry to the back of the recovery queue.
export function sortBackgroundSheetRecoveryCandidates(orders = []) {
  const priority = { failed: 0, pending: 1, writing: 2 };
  const timestamp = (order) => {
    const value = Date.parse(String(order?.updatedAtIso ?? ''));
    return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
  };
  return [...orders].sort((left, right) => (
    (priority[left?.sheetSyncStatus] ?? 9) - (priority[right?.sheetSyncStatus] ?? 9)
    || timestamp(left) - timestamp(right)
    || String(left?.id ?? '').localeCompare(String(right?.id ?? ''))
  ));
}

// A large failed backlog must not hide stale pending/writing leases forever. The caller
// already limits the number of rows read from each Firestore status, so take one oldest row
// from each status first, then fill any remaining slots by the normal priority order.
function selectFairHistoricalCandidates(orders, maxRows) {
  const limit = Math.max(0, Number.isFinite(maxRows) ? Math.floor(maxRows) : 0);
  if (!limit) return [];

  const byStatus = new Map();
  for (const order of orders) {
    const status = order?.sheetSyncStatus;
    if (!byStatus.has(status)) byStatus.set(status, []);
    byStatus.get(status).push(order);
  }

  const selected = [];
  for (const status of ['failed', 'pending', 'writing']) {
    const candidate = byStatus.get(status)?.shift();
    if (candidate) selected.push(candidate);
    if (selected.length >= limit) return selected;
  }

  const selectedIds = new Set(selected.map((order) => order.id));
  return [
    ...selected,
    ...orders.filter((order) => !selectedIds.has(order.id)),
  ].slice(0, limit);
}

// Keep a bounded share of every background batch moving the historical queue. Without this,
// a steady stream of today's scans can keep the older outbox permanently behind the daily queue.
export function selectBackgroundSheetRecoveryCandidates({
  todayCandidates = [],
  historicalCandidates = [],
  maxRows = SHEET_RECOVERY_MAX_ROWS,
}) {
  const limit = Math.max(0, Number.isFinite(maxRows) ? Math.floor(maxRows) : 0);
  if (!limit) return [];
  const historicalSlots = historicalCandidates.length
    ? Math.min(historicalCandidates.length, Math.max(1, Math.floor(limit / 2)))
    : 0;
  const todayRows = todayCandidates.slice(0, limit - historicalSlots);
  const remaining = limit - todayRows.length;
  return [
    ...todayRows,
    ...selectFairHistoricalCandidates(historicalCandidates, remaining),
  ];
}

export function buildSheetSyncFailureUpdates(orders = [], error = null) {
  const message = userErrorMessage(error, 'ซิงก์ Google Sheet ไม่สำเร็จ');
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

export async function collectManualSheetRecoveryCandidates({ dates, role = 'both', cap, readDate, readPacker, readAdmin }) {
  const byId = new Map();
  let limited = false;
  for (const date of [...new Set(dates)]) {
    const readers = [readDate, ...(role !== 'admin' ? [readPacker] : []), ...(role !== 'packer' ? [readAdmin] : [])];
    for (const read of readers) {
      // An index/network failure must reach the operator; an empty fallback is not proof
      // that a day's cross-day scan events have all been checked.
      const orders = await read(date);
      limited ||= orders.length >= cap;
      for (const order of orders) {
        if (shouldIncludeInManualSheetRecovery(order, role)) byId.set(order.id, order);
      }
    }
  }
  const priority = (order) => order.sheetSyncStatus === 'failed' ? 0 : isSheetSyncVerified(order) ? 2 : 1;
  const candidates = [...byId.values()].sort((a, b) => priority(a) - priority(b)
    || (priority(a) === 2 ? String(a.sheetVerifiedAtIso ?? '').localeCompare(String(b.sheetVerifiedAtIso ?? '')) : 0));
  // Keep already verified rows out of a batch while there is actionable work. If a mixed
  // batch hits a transient Sheets error, claiming verified rows would unnecessarily turn
  // them back into pending work and multiply the quota load.
  const unverified = candidates.filter((order) => !isSheetSyncVerified(order));
  return { candidates: unverified.length ? unverified : candidates, limited };
}

// Claim only the next bounded batch. Claiming a whole day first lets later leases expire
// before their Sheet request starts, and one failed transaction used to strand the rest.
export async function runSheetRecovery({
  candidates = [], batchSize = SHEET_RECOVERY_MAX_ROWS, claim, markWriting, write, markResult, isConfirmed, onProgress,
  onOrderResult,
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('Invalid recovery batch size');
  const state = { considered: 0, claimed: 0, synced: 0, failed: 0, skipped: 0 };
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const writing = [];
    for (const candidate of batch) {
      try {
        const order = await claim(candidate);
        if (!order) {
          state.skipped += 1;
          onOrderResult?.(candidate, { ok: false, skipped: true });
          continue;
        }
        state.claimed += 1;
        if (await markWriting(order) !== true) {
          state.skipped += 1;
          onOrderResult?.(order, { ok: false, skipped: true });
          continue;
        }
        writing.push(order);
      } catch (error) {
        state.failed += 1;
        onOrderResult?.(candidate, { ok: false, error });
      }
    }
    let results = [];
    let batchError = null;
    if (writing.length) {
      try { results = await write(writing); } catch (error) { batchError = error; }
    }
    for (const order of writing) {
      // Never match by array position: the Sheet service groups/reorders by date and may
      // return a failure without a row. Every claimed order needs its own acknowledgement.
      const matches = (Array.isArray(results) ? results : []).filter((item) => item?.order?.id === order.id);
      const item = matches.length === 1 ? matches[0] : null;
      try {
        const ok = !batchError && !item?.error && isConfirmed(item?.result, order);
        const error = batchError || item?.error || Object.assign(
          new Error('ยังยืนยันข้อมูลสแกนใน Google Sheet ไม่ได้ กรุณากู้คืนอีกครั้ง'),
          { code: 'SHEET_RECOVERY_UNCONFIRMED' },
        );
        const acknowledged = await markResult(order, {
          ok: Boolean(ok),
          result: item?.result,
          error: ok ? null : error,
          retryable: !ok && isRetryableSheetSyncError(error),
        });
        if (ok && acknowledged === true) {
          state.synced += 1;
          onOrderResult?.(order, { ok: true, result: item?.result });
        } else {
          state.failed += 1;
          onOrderResult?.(order, { ok: false, error });
        }
      } catch (error) {
        // A Sheet write alone is not a completed sync when Firestore rejects its ack.
        state.failed += 1;
        onOrderResult?.(order, { ok: false, error });
      }
    }
    state.considered += batch.length;
    onProgress?.({ ...state });
  }
  return state;
}
