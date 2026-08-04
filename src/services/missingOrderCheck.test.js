import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMissingAlertMessage } from './missingOrderCheck.js';

function results(overrides = {}) {
  return {
    hoursLookback: 6,
    thresholdMinutes: 30,
    checkTime: '2026-08-05T09:00:00.000Z',
    totalAdminScans: 2,
    matched: [],
    pending: [],
    tooSoon: [],
    cancelled: [],
    damaged: [],
    ...overrides,
  };
}

test('builds the clipboard report without throwing when orders are pending', () => {
  // Regression: the pending section referenced an undeclared `regularPending`, so this
  // threw a ReferenceError before reaching the clipboard and the button looked dead.
  const message = buildMissingAlertMessage(results({
    pending: [{ adminCode: 'TH123', courier: 'SPX', adminTime: '09:00' }],
  }));
  assert.match(message, /ออเดอร์ตกหล่น/);
  assert.match(message, /TH123/);
  assert.match(message, /SPX/);
});

test('omits the pending section when nothing is overdue', () => {
  const message = buildMissingAlertMessage(results());
  assert.doesNotMatch(message, /TH123/);
  assert.match(message, /ยังไม่แพ็ค \(เกินเวลา\): 0 รายการ/);
});

test('returns an empty string for a missing result set', () => {
  assert.equal(buildMissingAlertMessage(null), '');
});
