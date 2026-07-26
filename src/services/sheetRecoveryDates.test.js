import assert from 'node:assert/strict';
import test from 'node:test';

import { getSheetRecoveryDates } from './sheetRecoveryDates.js';

test('builds an ordered date list for recovering previous Sheet tabs', () => {
  assert.deepEqual(
    getSheetRecoveryDates({ startDate: '2026-07-25', endDate: '2026-07-27' }),
    ['2026-07-25', '2026-07-26', '2026-07-27'],
  );
});

test('returns no recovery dates for an incomplete or reversed range', () => {
  assert.deepEqual(getSheetRecoveryDates({ startDate: '2026-07-25', endDate: '' }), []);
  assert.deepEqual(getSheetRecoveryDates({ startDate: '2026-07-27', endDate: '2026-07-25' }), []);
});
