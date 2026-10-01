import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addSheetRecoveryOrderId,
  loadSheetRecoveryOrderIds,
  removeSheetRecoveryOrderId,
} from './sheetRecoveryQueue.js';

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    value(key) { return values.get(key) ?? null; },
  };
}

test('persists a targeted recovery id and restores it after a page reload', () => {
  const storage = createStorage();
  addSheetRecoveryOrderId('order-1', storage);

  assert.deepEqual(loadSheetRecoveryOrderIds(storage), ['order-1']);
});

test('removes only the order that has been verified', () => {
  const storage = createStorage();
  addSheetRecoveryOrderId('order-1', storage);
  addSheetRecoveryOrderId('order-2', storage);

  removeSheetRecoveryOrderId('order-1', storage);

  assert.deepEqual(loadSheetRecoveryOrderIds(storage), ['order-2']);
});

test('ignores malformed, blank, and duplicate stored ids', () => {
  const storage = createStorage({
    'scan-to-sheet-recovery-order-ids-v1': JSON.stringify([' order-1 ', '', 'order-1', 7, null]),
  });

  assert.deepEqual(loadSheetRecoveryOrderIds(storage), ['order-1']);
});
