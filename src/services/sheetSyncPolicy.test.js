import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SHEET_RECOVERY_COOLDOWN_MS,
  SHEET_RECOVERY_INTERVAL_MS,
  SHEET_RECOVERY_MAX_ROWS,
  SHEET_RECOVERY_TARGETED_MAX_ROWS,
  getSheetRecoveryBatchSize,
  getSheetRecoveryRetryDelay,
  shouldPreflightSheetRecoveryLock,
  shouldApplySheetRecoveryCooldown,
} from './sheetSyncPolicy.js';

test('background Sheet recovery is deliberately bounded', () => {
  assert.equal(SHEET_RECOVERY_MAX_ROWS, 3);
  assert.equal(SHEET_RECOVERY_INTERVAL_MS, 10 * 60 * 1000);
  assert.equal(SHEET_RECOVERY_COOLDOWN_MS, 10 * 60 * 1000);
  assert.equal(SHEET_RECOVERY_TARGETED_MAX_ROWS, 1);
  assert.equal(getSheetRecoveryBatchSize(), SHEET_RECOVERY_MAX_ROWS);
  assert.equal(getSheetRecoveryBatchSize({ targeted: true }), SHEET_RECOVERY_TARGETED_MAX_ROWS);
});

test('manual recovery can continue after one bounded batch without the background cooldown', () => {
  assert.equal(shouldApplySheetRecoveryCooldown({ showStatus: false, includeSynced: false }), true);
  assert.equal(shouldApplySheetRecoveryCooldown({ showStatus: true, includeSynced: true }), false);
});

test('targeted recovery bypasses only the background cooldown', () => {
  assert.equal(shouldApplySheetRecoveryCooldown({ targeted: true }), false);
  assert.equal(shouldApplySheetRecoveryCooldown({ targeted: true, showStatus: true }), false);
  assert.equal(shouldApplySheetRecoveryCooldown({ targeted: true, includeSynced: true }), false);
});

test('background recovery must acquire the shared Sheet lock before claiming rows', () => {
  assert.equal(shouldPreflightSheetRecoveryLock(), true);
  assert.equal(shouldPreflightSheetRecoveryLock({ showStatus: true }), false);
  assert.equal(shouldPreflightSheetRecoveryLock({ includeSynced: true }), false);
  assert.equal(shouldPreflightSheetRecoveryLock({ targeted: true }), false);
});

test('background recovery retries infrastructure failures promptly instead of applying the ten-minute cooldown', () => {
  assert.equal(getSheetRecoveryRetryDelay({ error: true }), 60 * 1000);
  assert.equal(getSheetRecoveryRetryDelay({ failed: 1 }), 60 * 1000);
  assert.equal(getSheetRecoveryRetryDelay({}), SHEET_RECOVERY_COOLDOWN_MS);
});
