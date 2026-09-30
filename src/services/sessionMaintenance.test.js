import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GOOGLE_SHEET_MAINTENANCE_DELAY_MS,
  scheduleDeferredGoogleSheetMaintenance,
} from './sessionMaintenance.js';

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
