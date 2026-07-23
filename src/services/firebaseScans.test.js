import test from 'node:test';
import assert from 'node:assert/strict';

import { nextCalendarDate } from './calendarDate.js';
import { SHEET_SYNC_STALE_MS, isSheetSyncClaimable, shouldReconcileSheetOnRescan } from './sheetSync.js';

test('nextCalendarDate advances without depending on local timezone', () => {
  assert.equal(nextCalendarDate('2026-07-18'), '2026-07-19');
  assert.equal(nextCalendarDate('2026-01-31'), '2026-02-01');
  assert.equal(nextCalendarDate('2026-12-31'), '2027-01-01');
});

test('only failed or stale per-order Sheet syncs can be claimed again', () => {
  const now = Date.now();
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'synced' }, now), false);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'failed' }, now), true);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'pending', sheetSyncStartedAtIso: new Date(now - 1_000).toISOString() }, now), false);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'pending', sheetSyncStartedAtIso: new Date(now - SHEET_SYNC_STALE_MS).toISOString() }, now), true);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'pending' }, now), true);
});

test('a rescan retries only an unsynced scan and keeps a synced order duplicate', () => {
  assert.equal(shouldReconcileSheetOnRescan({ admin: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'synced' }, 'admin'), false);
  assert.equal(shouldReconcileSheetOnRescan({ packerScan: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'synced' }, 'packerScan'), false);
  assert.equal(shouldReconcileSheetOnRescan({ admin: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'pending' }, 'admin'), true);
  assert.equal(shouldReconcileSheetOnRescan({ packerScan: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'failed' }, 'packerScan'), true);
  assert.equal(shouldReconcileSheetOnRescan({ sheetSyncStatus: 'failed' }, 'admin'), false);
});
