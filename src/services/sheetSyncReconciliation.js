function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function scanParts(value) {
  const text = String(value ?? '');
  const [date = '', time = ''] = text.split('T');
  return { date, time: time.slice(0, 8) };
}

export function getScanIssueMeta(note = '') {
  if (note === 'ลูกค้ายกเลิก') {
    return { isIssue: true, sheetStatus: 'Cancelled', resultStatus: 'cancelled', firestoreStatus: 'cancelled' };
  }
  if (note === 'สินค้าตีกลับ') {
    return { isIssue: true, sheetStatus: 'Returned', resultStatus: 'returned', firestoreStatus: 'returned' };
  }
  return { isIssue: false, sheetStatus: 'Success', resultStatus: 'success', firestoreStatus: 'packer_scanned' };
}

export function findHistoricalIssueRow(rows, { courier, code }) {
  const normalizedCode = normalizeCode(code);
  return rows.find((row) => row.courier === courier && normalizeCode(row.code) === normalizedCode)
    ?? rows.find((row) => row.courier === courier && normalizeCode(row.adminCode) === normalizedCode)
    ?? rows.find((row) => normalizeCode(row.code) === normalizedCode || normalizeCode(row.adminCode) === normalizedCode)
    ?? null;
}

/**
 * What to do with a Packer row found on an earlier day's sheet.
 *
 * The cross-day searches only ever looked at the Admin column, so a row the Packer created
 * yesterday was invisible today and the scan appended a second row on today's sheet — leaving
 * yesterday's row still counted as รอแพ็ค and the two sheets disagreeing about one parcel.
 *
 * `fill-packer` covers the row that was written without a name (the picker defaults to
 * unassigned): the name belongs on the original row, not on a new one.
 */
export function resolveCrossDayPackerRow(row, { packerName = '' } = {}) {
  if (!row) return { action: 'none' };
  const rowHasPacker = Boolean(String(row.packer ?? '').trim());
  const scanHasPacker = Boolean(String(packerName ?? '').trim());
  if (!rowHasPacker && scanHasPacker) return { action: 'fill-packer', row };
  return { action: 'duplicate', row };
}

/**
 * Deliberately courier-blind: the same tracking number under a different courier is still the
 * same parcel, so it is still a duplicate. The courier used to be a parameter that the body
 * never read, which read as an oversight rather than as the rule.
 */
export function shouldBlockPackerScan(rows, code) {
  const normalizedCode = normalizeCode(code);
  return rows.some((row) => normalizeCode(row.code) === normalizedCode);
}

export function getPackerDuplicateMessage(code) {
  return `${normalizeCode(code)} Packer สแกนแล้ว กรุณาตรวจสอบ`;
}

export function findScanReconciliation(rows, { courier, code, isPacker, packerName = '' }) {
  const normalizedCode = normalizeCode(code);
  const courierRows = rows.filter((row) => !courier || row.courier === courier);
  const adminRow = courierRows.find((row) => normalizeCode(row.adminCode) === normalizedCode)
    ?? rows.find((row) => normalizeCode(row.adminCode) === normalizedCode);
  const packerRow = courierRows.find((row) => normalizeCode(row.code) === normalizedCode)
    ?? rows.find((row) => normalizeCode(row.code) === normalizedCode);

  if (isPacker) {
    if (packerRow) {
      // A matching code in the packer column already proves a packer scanned this parcel;
      // the packer *name* is optional (the picker defaults to unassigned). Only re-write
      // the row when this scan supplies a name the row is missing, otherwise an unnamed
      // packer rescanning would overwrite the original scan time and be reported as a
      // fresh success instead of a duplicate.
      const rowHasPacker = Boolean(String(packerRow.packer ?? '').trim());
      const scanHasPacker = Boolean(String(packerName ?? '').trim());
      return (!rowHasPacker && scanHasPacker)
        ? { action: 'merge-packer', row: packerRow }
        : { action: 'skip', row: packerRow };
    }
    if (adminRow) return { action: 'merge-packer', row: adminRow };
  } else {
    if (adminRow) return { action: 'skip', row: adminRow };
    if (packerRow) return { action: 'merge-admin', row: packerRow };
  }

  return { action: 'create', row: null };
}

export function getAdminScanTiming(order, { fallbackDate = '', fallbackTime = '' } = {}) {
  const adminParts = scanParts(order?.admin?.scannedAt);
  const packerParts = scanParts(order?.packerScan?.scannedAt);
  const adminDate = adminParts.date || order?.adminDate || order?.date || fallbackDate;
  const adminTime = adminParts.time || order?.adminTime || fallbackTime;
  const hasPacker = Boolean(order?.packerScan?.scannedAt);

  return {
    sheetDate: hasPacker
      ? packerParts.date || order?.date || adminDate
      : adminDate,
    sheetTime: hasPacker
      ? packerParts.time || fallbackTime
      : adminTime,
    adminDate,
    adminTime,
  };
}

export function isSheetSyncResultConfirmed(result, expectedOrder = null) {
  if (!result) return false;

  const row = result.row;
  const isPacker = typeof result.isPacker === 'boolean'
    ? result.isPacker
    : !['admin_scan', 'admin_matched'].includes(result.status);
  const rowCode = isPacker ? row?.code : row?.adminCode;
  if (!row || normalizeCode(rowCode) !== normalizeCode(result.code)) return false;

  if (expectedOrder) {
    const code = normalizeCode(expectedOrder.code || expectedOrder.normalizedCode);
    if (!code || code !== normalizeCode(result.code)) return false;
    if (result.nativeDataTypesVerified !== true && row.nativeDataTypesVerified !== true) return false;
    const sameTime = (actual, expected) => {
      const normalize = (value) => String(value ?? '').split(':').map((part) => part.padStart(2, '0')).join(':');
      return normalize(actual) === normalize(expected);
    };
    if (expectedOrder.packerScan?.scannedAt) {
      const parts = scanParts(expectedOrder.packerScan.scannedAt);
      const note = expectedOrder.packerScan.note ?? expectedOrder.note ?? '';
      const packer = String(expectedOrder.packerScan.packer ?? expectedOrder.packer ?? '').trim();
      if (normalizeCode(row.code) !== code || row.date !== parts.date || !sameTime(row.time, parts.time)) return false;
      if (row.status !== getScanIssueMeta(note).sheetStatus) return false;
      if (packer && String(row.packer ?? '').trim() !== packer) return false;
      if (note && !String(row.note ?? '').includes(note)) return false;
    }
    if (expectedOrder.admin?.scannedAt) {
      const parts = scanParts(expectedOrder.admin.scannedAt);
      if (normalizeCode(row.adminCode) !== code || row.adminDate !== parts.date || !sameTime(row.adminTime, parts.time)) return false;
    }
  }

  // A duplicate performs no logical write, but it may have been left by a legacy client with
  // date/time values stored as text. The Google Sheets grid read must prove native types before
  // the order is removed from recovery; append*Google repairs the row before returning this.
  if (result.status === 'duplicate') {
    return result.nativeDataTypesVerified === true || row.nativeDataTypesVerified === true;
  }

  const rowStatus = String(row.status ?? '').trim();
  if (result.status === 'success') return rowStatus === 'Success';
  if (result.status === 'cancelled') return rowStatus === 'Cancelled';
  if (result.status === 'returned') return rowStatus === 'Returned';
  if (result.status === 'admin_scan') return rowStatus === 'รอแพ็ค';
  if (result.status === 'admin_matched') {
    return ['Success', 'Cancelled', 'Damaged', 'Issue', 'Returned'].includes(rowStatus);
  }

  return false;
}
