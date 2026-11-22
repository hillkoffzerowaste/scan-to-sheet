export function normalizeScanTracking(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function scanTrackingKey(value) {
  return Array.from(new TextEncoder().encode(normalizeScanTracking(value)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function scanError(code) {
  return Object.assign(new Error('ข้อมูลการสแกนไม่ตรงกัน กรุณาให้ผู้ดูแลตรวจสอบ'), { code });
}

export function validateScanAttempt(attempt, context, receipt = null) {
  const valid = attempt && typeof attempt.id === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(attempt.id)
    && typeof attempt.tracking === 'string' && typeof attempt.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(attempt.date)
    && typeof attempt.courier === 'string' && attempt.courier.trim().length > 0
    && ['admin', 'packer'].includes(attempt.role)
    && typeof attempt.source === 'string' && attempt.source.length > 0 && attempt.source.length <= 80
    && attempt.actorUid && attempt.actorUid === context.actorUid
    && attempt.role === context.role && normalizeScanTracking(attempt.tracking) === normalizeScanTracking(context.tracking)
    && attempt.date === context.date && attempt.courier === context.courier;
  if (!valid) throw scanError('SCAN_ATTEMPT_CONTEXT');
  if (receipt && ['id', 'role', 'date', 'courier', 'actorUid', 'source'].some((key) => receipt[key] !== attempt[key])) throw scanError('SCAN_ATTEMPT_REUSED');
  if (receipt && normalizeScanTracking(receipt.tracking) !== normalizeScanTracking(attempt.tracking)) throw scanError('SCAN_ATTEMPT_REUSED');
  return { ...attempt, tracking: normalizeScanTracking(attempt.tracking) };
}

export function getScanCountSummary(order = {}) {
  const known = Number.isSafeInteger(order.scanTotalAdmin) && Number.isSafeInteger(order.scanTotalPacker);
  if (!known && (order.scanTotalAdmin !== undefined || order.scanTotalPacker !== undefined)) throw scanError('SCAN_COUNTS_INVALID');
  if (order.scanCountRevision !== undefined && (!Number.isSafeInteger(order.scanCountRevision) || order.scanCountRevision < 0)) throw scanError('SCAN_COUNTS_INVALID');
  const scanTotalAdmin = known ? order.scanTotalAdmin : (order.admin?.scannedAt ? 1 : 0);
  const scanTotalPacker = known ? order.scanTotalPacker : (order.packerScan?.scannedAt ? 1 : 0);
  if (scanTotalAdmin < 0 || scanTotalPacker < 0) throw scanError('SCAN_COUNTS_INVALID');
  return {
    scanTotalAdmin, scanTotalPacker,
    scanDuplicateAdmin: Math.max(scanTotalAdmin - 1, 0),
    scanDuplicatePacker: Math.max(scanTotalPacker - 1, 0),
    scanCountRevision: Number.isSafeInteger(order.scanCountRevision) ? order.scanCountRevision : 0,
    scanHistoryUnknown: order.scanHistoryUnknown === true || !known,
    risk: scanTotalAdmin > 1 && scanTotalPacker > 1,
  };
}

export function nextScanCounts(order, role) {
  if (!['admin', 'packer'].includes(role)) throw scanError('SCAN_ATTEMPT_CONTEXT');
  const previous = getScanCountSummary(order ?? { scanTotalAdmin: 0, scanTotalPacker: 0 });
  const admin = previous.scanTotalAdmin + (role === 'admin' ? 1 : 0);
  const packer = previous.scanTotalPacker + (role === 'packer' ? 1 : 0);
  return {
    scanTotalAdmin: admin, scanTotalPacker: packer,
    scanDuplicateAdmin: Math.max(admin - 1, 0), scanDuplicatePacker: Math.max(packer - 1, 0),
    scanCountRevision: previous.scanCountRevision + 1, scanHistoryUnknown: previous.scanHistoryUnknown,
  };
}

export async function commitScanAttemptTransaction({ transaction, attempt, pointerRef, receiptRef, orderRef, candidate, timestamp, makeOrder, onReadOrder = () => {} }) {
  const receiptSnap = await transaction.get(receiptRef);
  const pointerSnap = await transaction.get(pointerRef);
  const receipt = receiptSnap.exists() ? receiptSnap.data() : null;
  validateScanAttempt(attempt, attempt, receipt);
  const key = scanTrackingKey(attempt.tracking);
  const pointer = pointerSnap.exists() ? pointerSnap.data() : null;
  const id = receipt?.orderId || pointer?.orderId || candidate?.id || `tracking_${key}`;
  if (pointer && (pointer.tracking !== attempt.tracking || (receipt && pointer.orderId !== receipt.orderId))) throw scanError('SCAN_CANONICAL_CONFLICT');
  const ref = orderRef(id);
  const orderSnap = await transaction.get(ref);
  const existing = orderSnap.exists() ? orderSnap.data() : null;
  onReadOrder(existing?.scanCountRevision ?? 0);
  if (existing && normalizeScanTracking(existing.normalizedCode || existing.code) !== attempt.tracking) throw scanError('SCAN_CANONICAL_CONFLICT');
  if (receipt) {
    if (!existing || !pointer) throw scanError('SCAN_CANONICAL_CONFLICT');
    return { id, order: existing, existing, replayed: true };
  }
  if (pointer && !existing) throw scanError('SCAN_CANONICAL_CONFLICT');
  const order = { ...makeOrder(existing), ...nextScanCounts(existing, attempt.role), scanLastAttemptId: attempt.id, scanTrackingKey: key };
  transaction.set(ref, order);
  if (!pointer) transaction.set(pointerRef, { tracking: attempt.tracking, orderId: id });
  transaction.set(receiptRef, { ...attempt, orderId: id, trackingKey: key, revision: order.scanCountRevision, createdAt: timestamp });
  return { id, order, existing, replayed: false };
}

export function canVerifyScanRevision(order, result) {
  return !order.scanCountRevision || result?.scanCountRevision === order.scanCountRevision;
}

export async function runScanAttemptWithContentionRetry({ commit, readCurrentRevision, maxAttempts = 3 }) {
  for (let index = 0; index < maxAttempts; index++) {
    let observedRevision = null;
    try {
      return await commit((revision) => { observedRevision = revision; });
    } catch (error) {
      if (!['permission-denied', 'firestore/permission-denied'].includes(error?.code)
        || observedRevision === null || index + 1 >= maxAttempts) throw error;
      // Rules can see a winning commit before the SDK reports an optimistic conflict.
      // Re-read after that denial; unrelated permission failures must not be retried.
      const revision = await readCurrentRevision();
      if (!Number.isSafeInteger(revision) || revision <= observedRevision) throw error;
    }
  }
}
