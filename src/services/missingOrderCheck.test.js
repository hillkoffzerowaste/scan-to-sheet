import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDashboardSummary,
  buildMissingAlertMessage,
  formatMissingResultsForUI,
} from './missingOrderCheck.js';

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

test('the dashboard and the section list agree on the pending split', () => {
  // `pendingOverOneDay` holds the same row objects as `pending`. The dashboard used the raw
  // lengths, so five orders over one day read as "ตกหล่น 5" plus "เกิน 1 วัน 5" — ten
  // problems — while the section list below already subtracted them.
  const overdue = { adminCode: 'TH-OLD', courier: 'SPX', adminTime: '08:00' };
  const recent = { adminCode: 'TH-NEW', courier: 'Flash', adminTime: '09:00' };
  const data = results({ pending: [recent, overdue], pendingOverOneDay: [overdue] });

  const summary = buildDashboardSummary(data);
  assert.equal(summary.pendingCount, 1);
  assert.equal(summary.pendingOverOneDayCount, 1);
  assert.equal(summary.pendingCount + summary.pendingOverOneDayCount, summary.pendingTotalCount);

  const sections = formatMissingResultsForUI(data);
  assert.equal(sections.find((section) => section.type === 'pending').count, 1);
  assert.equal(sections.find((section) => section.type === 'pendingOverOneDay').count, 1);
});

test('omits the overdue section when every pending order is over one day old', () => {
  // The guard tested `results.pending.length`, so this rendered an "ออเดอร์ตกหล่น" card
  // reading 0 with no rows, right above the card holding all of them.
  const overdue = { adminCode: 'TH-OLD', courier: 'SPX', adminTime: '08:00' };
  const sections = formatMissingResultsForUI(
    results({ pending: [overdue], pendingOverOneDay: [overdue] }),
  );

  assert.equal(sections.some((section) => section.type === 'pending'), false);
  assert.equal(sections.find((section) => section.type === 'pendingOverOneDay').count, 1);
});

test('reports returned parcels as their own category, not as missing orders', () => {
  const data = results({ returned: [{ adminCode: 'TH-RET', courier: 'SPX', adminTime: '08:00' }] });

  assert.match(buildMissingAlertMessage(data), /สินค้าตีกลับ: 1 รายการ/);
  assert.equal(formatMissingResultsForUI(data).find((section) => section.type === 'returned').count, 1);
});
