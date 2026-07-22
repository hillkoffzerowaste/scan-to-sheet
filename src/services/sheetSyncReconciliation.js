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
    ?? null;
}

export function shouldBlockPackerScan(rows, code, courier = null) {
  const normalizedCode = normalizeCode(code);
  return rows.some((row) => (
    (!courier || row.courier === courier)
      && normalizeCode(row.code) === normalizedCode
  ));
}

export function findScanReconciliation(rows, { courier, code, isPacker }) {
  const normalizedCode = normalizeCode(code);
  const courierRows = rows.filter((row) => !courier || row.courier === courier);
  const adminRow = courierRows.find((row) => normalizeCode(row.adminCode) === normalizedCode);
  const packerRow = courierRows.find((row) => normalizeCode(row.code) === normalizedCode);

  if (isPacker) {
    if (packerRow) return { action: 'skip', row: packerRow };
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
      ? order?.date || packerParts.date || adminDate
      : adminDate,
    sheetTime: hasPacker
      ? packerParts.time || fallbackTime
      : adminTime,
    adminDate,
    adminTime,
  };
}
