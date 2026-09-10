import { userErrorMessage } from './authErrors.js';

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

export function isSheetSyncVerified(order) {
  return ['verified', 'synced'].includes(order?.sheetSyncStatus);
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

export function shouldReconcileSheetOnRescan(order, scanType) {
  return Boolean(
    order?.[scanType]?.scannedAt
    && !isSheetSyncVerified(order),
  );
}

export function prioritizeSheetSyncCandidates({ failed = [], pending = [], maxRows = Infinity }) {
  return [...failed, ...pending].slice(0, Math.max(0, maxRows));
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
  return { candidates, limited };
}

// Claim only the next bounded batch. Claiming a whole day first lets later leases expire
// before their Sheet request starts, and one failed transaction used to strand the rest.
export async function runSheetRecovery({
  candidates = [], batchSize = 20, claim, markWriting, write, markResult, isConfirmed, onProgress,
}) {
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('Invalid recovery batch size');
  const state = { considered: 0, claimed: 0, synced: 0, failed: 0, skipped: 0 };
  for (let offset = 0; offset < candidates.length; offset += batchSize) {
    const batch = candidates.slice(offset, offset + batchSize);
    const writing = [];
    for (const candidate of batch) {
      try {
        const order = await claim(candidate);
        if (!order) { state.skipped += 1; continue; }
        state.claimed += 1;
        if (await markWriting(order) !== true) { state.skipped += 1; continue; }
        writing.push(order);
      } catch {
        state.failed += 1;
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
        const acknowledged = await markResult(order, { ok: Boolean(ok), result: item?.result, error: ok ? null : error });
        if (ok && acknowledged === true) state.synced += 1;
        else state.failed += 1;
      } catch {
        // A Sheet write alone is not a completed sync when Firestore rejects its ack.
        state.failed += 1;
      }
    }
    state.considered += batch.length;
    onProgress?.({ ...state });
  }
  return state;
}
