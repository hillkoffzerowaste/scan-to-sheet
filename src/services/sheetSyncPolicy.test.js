import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHEET_RECOVERY_COOLDOWN_MS,
  SHEET_RECOVERY_INTERVAL_MS,
  SHEET_RECOVERY_MAX_ROWS,
} from './sheetSyncPolicy.js';

test('background Sheet recovery is deliberately bounded', () => {
  assert.equal(SHEET_RECOVERY_MAX_ROWS, 10);
  assert.equal(SHEET_RECOVERY_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(SHEET_RECOVERY_COOLDOWN_MS, 10 * 60 * 1000);
});
