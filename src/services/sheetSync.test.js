import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSheetSyncFailureUpdates } from './sheetSync.js';

test('builds failure updates for every claimed Sheet sync', () => {
  const updates = buildSheetSyncFailureUpdates([
    { id: 'order-1', sheetSyncAttemptId: 'attempt-1' },
    { id: 'order-2', sheetSyncAttemptId: 'attempt-2' },
  ], new Error('Google API request timed out'));

  assert.deepEqual(updates.map(({ orderId, attemptId, error }) => ({
    orderId,
    attemptId,
    error: error.message,
  })), [
    { orderId: 'order-1', attemptId: 'attempt-1', error: 'ซิงก์ Google Sheet ไม่สำเร็จ' },
    { orderId: 'order-2', attemptId: 'attempt-2', error: 'ซิงก์ Google Sheet ไม่สำเร็จ' },
  ]);
});

test('keeps an actionable Thai Sheet error for recovery diagnostics', () => {
  const [update] = buildSheetSyncFailureUpdates(
    [{ id: 'order-1' }],
    new Error('Google ตอบสนองช้าเกินกำหนด กรุณาลองใหม่'),
  );
  assert.equal(update.error.message, 'Google ตอบสนองช้าเกินกำหนด กรุณาลองใหม่');
});
