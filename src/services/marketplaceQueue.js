import { normalizeMarketplaceTracking } from './marketplaceImport.js';
import { ISSUE_CUSTOMER_CANCELLED, ISSUE_DAMAGED, ISSUE_RETURNED } from '../constants.js';

export const MARKETPLACE_QUEUE_LIMIT = 100;

export const MARKETPLACE_QUEUE_STATES = Object.freeze({
  NO_SCAN: 'no_scan',
  DRIVER_QUEUE: 'driver_queue',
  PACKER_ONLY: 'packer_only',
  MATCHED: 'matched',
  CANCELLED: 'cancelled',
  RETURNED: 'returned',
  DAMAGED: 'damaged',
});

const STATE_PRIORITY = Object.freeze({
  [MARKETPLACE_QUEUE_STATES.CANCELLED]: 4,
  [MARKETPLACE_QUEUE_STATES.RETURNED]: 4,
  [MARKETPLACE_QUEUE_STATES.DAMAGED]: 4,
  [MARKETPLACE_QUEUE_STATES.MATCHED]: 3,
  [MARKETPLACE_QUEUE_STATES.DRIVER_QUEUE]: 2,
  [MARKETPLACE_QUEUE_STATES.PACKER_ONLY]: 1,
  [MARKETPLACE_QUEUE_STATES.NO_SCAN]: 0,
});

export const MARKETPLACE_QUEUE_STATE_LABELS = Object.freeze({
  [MARKETPLACE_QUEUE_STATES.NO_SCAN]: 'ยังไม่เช็ค',
  [MARKETPLACE_QUEUE_STATES.DRIVER_QUEUE]: 'อยู่คิวคนขับแล้ว · รอเช็ค',
  [MARKETPLACE_QUEUE_STATES.PACKER_ONLY]: 'เช็คแล้ว · รอเข้าคิวคนขับ',
  [MARKETPLACE_QUEUE_STATES.MATCHED]: 'เช็คแล้ว · อยู่คิวคนขับ',
  [MARKETPLACE_QUEUE_STATES.CANCELLED]: 'ยกเลิก',
  [MARKETPLACE_QUEUE_STATES.RETURNED]: 'ตีกลับ',
  [MARKETPLACE_QUEUE_STATES.DAMAGED]: 'สินค้าเสียหาย',
});

function normalizeCode(value) {
  return normalizeMarketplaceTracking(value);
}

function issueState(order) {
  const note = String(order?.note ?? '').toLowerCase();
  const status = String(order?.status ?? '').toLowerCase();
  if (status === 'cancelled' || note.includes(ISSUE_CUSTOMER_CANCELLED.toLowerCase()) || note.includes('cancel')) {
    return MARKETPLACE_QUEUE_STATES.CANCELLED;
  }
  if (status === 'returned' || note.includes(ISSUE_RETURNED.toLowerCase()) || note.includes('return')) {
    return MARKETPLACE_QUEUE_STATES.RETURNED;
  }
  if (status === 'damaged' || note.includes(ISSUE_DAMAGED.toLowerCase()) || note.includes('damage')) {
    return MARKETPLACE_QUEUE_STATES.DAMAGED;
  }
  return null;
}

export function deriveMarketplaceQueueState(order) {
  if (!order) return MARKETPLACE_QUEUE_STATES.NO_SCAN;
  const issue = issueState(order);
  if (issue) return issue;

  const hasAdmin = Boolean(order.admin?.scannedAt || order.status === 'pending' || order.status === 'matched');
  const hasPacker = Boolean(order.packerScan?.scannedAt || order.status === 'packer_scanned' || order.status === 'matched');
  if (hasAdmin && hasPacker) return MARKETPLACE_QUEUE_STATES.MATCHED;
  if (hasAdmin) return MARKETPLACE_QUEUE_STATES.DRIVER_QUEUE;
  if (hasPacker) return MARKETPLACE_QUEUE_STATES.PACKER_ONLY;
  return MARKETPLACE_QUEUE_STATES.NO_SCAN;
}

export function marketplaceQueueStateLabel(state) {
  return MARKETPLACE_QUEUE_STATE_LABELS[state] ?? MARKETPLACE_QUEUE_STATE_LABELS[MARKETPLACE_QUEUE_STATES.NO_SCAN];
}

export function marketplaceQueueBadgeClass(state) {
  if (state === MARKETPLACE_QUEUE_STATES.MATCHED) return 'success';
  if ([MARKETPLACE_QUEUE_STATES.CANCELLED, MARKETPLACE_QUEUE_STATES.RETURNED, MARKETPLACE_QUEUE_STATES.DAMAGED].includes(state)) {
    return 'error';
  }
  return 'pending';
}

export function marketplaceQueueAction(state) {
  if ([MARKETPLACE_QUEUE_STATES.NO_SCAN, MARKETPLACE_QUEUE_STATES.DRIVER_QUEUE].includes(state)) return 'check';
  if (state === MARKETPLACE_QUEUE_STATES.PACKER_ONLY) return 'wait-admin';
  if (state === MARKETPLACE_QUEUE_STATES.MATCHED) return 'done';
  return 'none';
}

export function marketplaceQueueActionLabel(state) {
  const action = marketplaceQueueAction(state);
  if (action === 'check') return 'ดึงมาเช็ค';
  if (action === 'wait-admin') return 'รอ Admin';
  if (action === 'done') return 'ตรวจแล้ว';
  return '';
}

export function marketplaceQueueItemText(order, maxItems = 3) {
  const items = Array.isArray(order?.items) ? order.items : [];
  const skus = Array.isArray(order?.marketplaceSkus) ? order.marketplaceSkus : [];
  const labels = (items.length ? items : skus).map((item) => {
    if (typeof item === 'string') return item;
    const name = item?.name || item?.sku || '';
    const quantity = item?.quantity ? ` x${item.quantity}` : '';
    return `${name}${quantity}`.trim();
  }).filter(Boolean);
  if (!labels.length) return '-';
  const visible = labels.slice(0, maxItems).join(', ');
  return labels.length > maxItems ? `${visible} +${labels.length - maxItems}` : visible;
}

export function marketplaceDisplayTracking(order) {
  return String(order?.trackingNo || order?.normalizedTrackingNo || '-');
}

function orderTimestamp(order) {
  const value = order?.updatedAtIso ?? order?.updatedAt ?? order?.packerScan?.scannedAt ?? order?.admin?.scannedAt ?? '';
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function pickBestOrder(current, candidate) {
  if (!current) return candidate;
  const currentPriority = STATE_PRIORITY[deriveMarketplaceQueueState(current)] ?? 0;
  const candidatePriority = STATE_PRIORITY[deriveMarketplaceQueueState(candidate)] ?? 0;
  if (candidatePriority !== currentPriority) return candidatePriority > currentPriority ? candidate : current;
  return orderTimestamp(candidate) >= orderTimestamp(current) ? candidate : current;
}

export function mergeMarketplaceQueueOrders(catalogOrders = [], firestoreOrders = []) {
  const ordersByTracking = new Map();
  for (const order of firestoreOrders) {
    const key = normalizeCode(order?.normalizedCode || order?.code);
    if (!key) continue;
    ordersByTracking.set(key, pickBestOrder(ordersByTracking.get(key), order));
  }

  return catalogOrders.slice(0, MARKETPLACE_QUEUE_LIMIT).map((catalogOrder) => {
    const key = normalizeCode(catalogOrder?.normalizedTrackingNo || catalogOrder?.trackingNo);
    const firestoreOrder = ordersByTracking.get(key) ?? null;
    const queueState = deriveMarketplaceQueueState(firestoreOrder);
    return {
      ...catalogOrder,
      queueState,
      firestoreOrder,
      canPackerCheck: marketplaceQueueAction(queueState) === 'check',
    };
  });
}
