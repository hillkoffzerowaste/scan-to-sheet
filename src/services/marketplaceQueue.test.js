import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMarketplaceQueueState,
  MARKETPLACE_QUEUE_STATES,
  mergeMarketplaceQueueOrders,
  marketplaceQueueAction,
  marketplaceQueueItemText,
} from './marketplaceQueue.js';

const baseOrder = {
  normalizedCode: 'TH12345678',
  status: 'imported',
  updatedAtIso: '2026-09-22T10:00:00.000Z',
};

test('derives the Store queue state from Admin and Packer scans', () => {
  assert.equal(deriveMarketplaceQueueState(null), MARKETPLACE_QUEUE_STATES.NO_SCAN);
  assert.equal(deriveMarketplaceQueueState(baseOrder), MARKETPLACE_QUEUE_STATES.NO_SCAN);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, admin: { scannedAt: '2026-09-22T10:01:00' } }), MARKETPLACE_QUEUE_STATES.DRIVER_QUEUE);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, packerScan: { scannedAt: '2026-09-22T10:02:00' } }), MARKETPLACE_QUEUE_STATES.PACKER_ONLY);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, admin: { scannedAt: '2026-09-22T10:01:00' }, packerScan: { scannedAt: '2026-09-22T10:02:00' } }), MARKETPLACE_QUEUE_STATES.MATCHED);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, status: 'pending' }), MARKETPLACE_QUEUE_STATES.DRIVER_QUEUE);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, status: 'packer_scanned' }), MARKETPLACE_QUEUE_STATES.PACKER_ONLY);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, status: 'matched' }), MARKETPLACE_QUEUE_STATES.MATCHED);
});

test('issue states take precedence over scan progress', () => {
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, status: 'cancelled', admin: { scannedAt: 'x' } }), MARKETPLACE_QUEUE_STATES.CANCELLED);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, note: 'สินค้าตีกลับ', packerScan: { scannedAt: 'x' } }), MARKETPLACE_QUEUE_STATES.RETURNED);
  assert.equal(deriveMarketplaceQueueState({ ...baseOrder, note: 'สินค้าเสียหาย', packerScan: { scannedAt: 'x' } }), MARKETPLACE_QUEUE_STATES.DAMAGED);
});

test('joins every catalog row and chooses the strongest Firestore state per tracking', () => {
  const rows = mergeMarketplaceQueueOrders([
    { orderId: 'A', trackingNo: 'TH12345678', normalizedTrackingNo: 'TH12345678' },
    { orderId: 'B', trackingNo: 'TH99999999', normalizedTrackingNo: 'TH99999999' },
  ], [
    { id: 'old', normalizedCode: 'TH12345678', updatedAtIso: '2026-09-22T09:00:00.000Z' },
    { id: 'queue', normalizedCode: 'TH12345678', admin: { scannedAt: 'x' }, updatedAtIso: '2026-09-22T08:00:00.000Z' },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].queueState, MARKETPLACE_QUEUE_STATES.DRIVER_QUEUE);
  assert.equal(rows[0].firestoreOrder.id, 'queue');
  assert.equal(rows[0].canPackerCheck, true);
  assert.equal(rows[1].queueState, MARKETPLACE_QUEUE_STATES.NO_SCAN);
});

test('maps queue actions and item text for the Packer UI', () => {
  assert.equal(marketplaceQueueAction(MARKETPLACE_QUEUE_STATES.NO_SCAN), 'check');
  assert.equal(marketplaceQueueAction(MARKETPLACE_QUEUE_STATES.PACKER_ONLY), 'wait-admin');
  assert.equal(marketplaceQueueAction(MARKETPLACE_QUEUE_STATES.MATCHED), 'done');
  assert.equal(marketplaceQueueItemText({ items: [{ name: 'กาแฟ', quantity: 2 }, { sku: 'SKU-2' }] }), 'กาแฟ x2, SKU-2');
  assert.equal(marketplaceQueueItemText({ marketplaceSkus: ['SKU-1'] }), 'SKU-1');
});
