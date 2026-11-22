import { getScanCountSummary } from './scanAttempts.js';
import { getAdminScanTiming } from './sheetSyncReconciliation.js';

export function buildSheetRecoveryPayload(order, { userEmail = '', marketplaceOrder = null } = {}) {
  const timing = getAdminScanTiming(order);
  const hasAdmin = Boolean(order.admin?.scannedAt);
  const code = order.code || order.normalizedCode;
  return {
    ...(order.scanCountRevision > 0 ? getScanCountSummary(order) : {}),
    id: order.id, code, courier: order.courier,
    date: timing.sheetDate, time: timing.sheetTime,
    email: order.packerScan?.scannedBy?.email || order.admin?.scannedBy?.email || order.user?.email || userEmail,
    packer: order.packerScan?.packer ?? order.packer ?? '',
    note: order.packerScan?.note ?? order.note ?? '',
    isPacker: Boolean(order.packerScan?.scannedAt),
    adminDate: hasAdmin ? timing.adminDate : '',
    adminTime: hasAdmin ? timing.adminTime : '',
    adminCode: hasAdmin ? code : '',
    marketplaceOrder,
  };
}
