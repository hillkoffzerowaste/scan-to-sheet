import test from 'node:test';
import assert from 'node:assert/strict';

import { chunkTrackingNumbers } from './firestore.js';

const order = (orderId, normalizedTrackingNo) => ({
  orderId,
  normalizedTrackingNo,
  items: [{ name: 'กาแฟ', sku: 'SKU-1', quantity: 1 }],
});

test('queries each tracking number once, however many orders carry it', () => {
  // A split shipment repeats the tracking number; the old loop billed a read per order.
  const { chunks, byTracking } = chunkTrackingNumbers([
    order('A1', 'TH001'),
    order('A2', 'TH001'),
    order('A3', 'TH002'),
  ]);

  assert.deepEqual(chunks, [['TH001', 'TH002']]);
  assert.equal(byTracking.size, 2);
  assert.equal(byTracking.get('TH001').marketplaceOrderId, 'A1');
});

test('splits into chunks Firestore will accept for an `in` filter', () => {
  const orders = Array.from({ length: 65 }, (_, index) => order(`ORD-${index}`, `TH${index}`));
  const { chunks } = chunkTrackingNumbers(orders);

  assert.deepEqual(chunks.map((chunk) => chunk.length), [30, 30, 5]);
  assert.equal(chunks.flat().length, 65);
  assert.equal(new Set(chunks.flat()).size, 65);
});

test('skips orders with nothing to reconcile', () => {
  const { chunks, byTracking } = chunkTrackingNumbers([
    { orderId: '', normalizedTrackingNo: 'TH001', items: [] },
    { orderId: 'A2', normalizedTrackingNo: '', items: [] },
    order('A3', 'TH003'),
  ]);

  assert.deepEqual(chunks, [['TH003']]);
  assert.equal(byTracking.has('TH001'), false);
});

test('returns no chunks when there is nothing to do', () => {
  assert.deepEqual(chunkTrackingNumbers([]).chunks, []);
  assert.deepEqual(chunkTrackingNumbers(undefined).chunks, []);
});

test('metadata stays paired with its own tracking number', () => {
  // The chunked query returns matches for many tracking numbers at once, so the metadata
  // has to be looked up per match — writing the loop's current order to all of them was
  // the bug this shape prevents.
  const { byTracking } = chunkTrackingNumbers([order('A1', 'TH001'), order('B2', 'TH002')]);

  assert.equal(byTracking.get('TH001').marketplaceOrderId, 'A1');
  assert.equal(byTracking.get('TH002').marketplaceOrderId, 'B2');
});
