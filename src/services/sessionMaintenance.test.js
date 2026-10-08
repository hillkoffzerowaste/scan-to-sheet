import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOOGLE_SHEET_MAINTENANCE_DELAY_MS,
  GOOGLE_SESSION_EXPIRED,
  createGoogleSessionExpiredError,
  isGoogleAuthError,
  scheduleDeferredGoogleSheetMaintenance,
} from './sessionMaintenance.js';

test('recognizes an expired Google session as refreshable', () => {
  assert.equal(isGoogleAuthError(Object.assign(new Error('Google API error 401'), { status: 401 })), true);
  assert.equal(isGoogleAuthError(new Error('Google API error 403 permission_denied')), true);
  assert.equal(isGoogleAuthError(new Error('Google API error 500')), false);
});

test('gives an unrefreshable Google session a stable retryable error code', () => {
  const error = createGoogleSessionExpiredError(Object.assign(new Error('Google API error 401'), { status: 401 }));

  assert.equal(error.code, GOOGLE_SESSION_EXPIRED);
  assert.equal(error.status, 401);
  assert.match(error.message, /เซสชัน Google หมดอายุ/);
  assert.equal(error.cause.message, 'Google API error 401');
});

test('defers Google Sheet maintenance until after the login critical path', async () => {
  let scheduledTask = null;
  let scheduledDelay = null;
  let executed = 0;

  scheduleDeferredGoogleSheetMaintenance(() => {
    executed += 1;
  }, {
    setTimeoutFn: (task, delay) => {
      scheduledTask = task;
      scheduledDelay = delay;
      return 1;
    },
  });

  assert.equal(executed, 0);
  assert.equal(scheduledDelay, GOOGLE_SHEET_MAINTENANCE_DELAY_MS);
  await scheduledTask();
  assert.equal(executed, 1);
});

test('allows session cleanup to cancel deferred maintenance', () => {
  let clearedId = null;
  const cancel = scheduleDeferredGoogleSheetMaintenance(() => {}, {
    setTimeoutFn: () => 7,
    clearTimeoutFn: (id) => {
      clearedId = id;
    },
  });

  cancel();
  assert.equal(clearedId, 7);
});
