import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SHEET_LOCK_MAX_ATTEMPTS,
  getSheetLockRetryDelay,
} from './sheetLockBackoff.js';

test('backs off lock polling instead of retrying every 250ms', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map((attempt) => getSheetLockRetryDelay(attempt, 250)),
    [250, 500, 1000, 2000, 2000],
  );
  assert.equal(SHEET_LOCK_MAX_ATTEMPTS, 12);
});

test('never ignores a longer server-provided retry delay', () => {
  assert.equal(getSheetLockRetryDelay(0, 5000), 5000);
  assert.equal(getSheetLockRetryDelay(3, 100), 2000);
});
