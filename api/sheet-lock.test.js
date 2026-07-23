import test from 'node:test';
import assert from 'node:assert/strict';

import { LOCK_TTL_SECONDS, sheetLockKey } from './sheet-lock.js';

test('Sheet lock is shared by every user writing the same resource', () => {
  assert.equal(sheetLockKey('master-sheet-id'), sheetLockKey('master-sheet-id'));
  assert.notEqual(sheetLockKey('master-sheet-id'), sheetLockKey('other-sheet-id'));
});

test('Sheet lock remains valid for a complete recovery batch', () => {
  assert.ok(LOCK_TTL_SECONDS >= 120);
});
