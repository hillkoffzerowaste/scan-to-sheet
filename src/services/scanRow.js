export function getScanEventDate(order) {
  const scannedAt = order?.packerScan?.scannedAt
    || order?.admin?.scannedAt
    || order?.date
    || '';
  return String(scannedAt).split('T')[0];
}
