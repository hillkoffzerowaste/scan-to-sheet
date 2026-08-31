import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { nextCalendarDate } from './calendarDate.js';
import { getScanEventDate } from './scanRow.js';
import {
  SHEET_SYNC_STALE_MS,
  isSheetSyncVerified,
  isSheetSyncClaimable,
  prioritizeSheetSyncCandidates,
  shouldIncludeInManualSheetRecovery,
  shouldReconcileSheetOnRescan,
} from './sheetSync.js';

test('nextCalendarDate advances without depending on local timezone', () => {
  assert.equal(nextCalendarDate('2026-07-18'), '2026-07-19');
  assert.equal(nextCalendarDate('2026-01-31'), '2026-02-01');
  assert.equal(nextCalendarDate('2026-12-31'), '2027-01-01');
});

test('only failed or stale per-order Sheet syncs can be claimed again', () => {
  const now = Date.now();
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'synced' }, now), false);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'verified' }, now), false);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'writing', sheetSyncStartedAtIso: new Date(now - 1_000).toISOString() }, now), false);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'writing', sheetSyncStartedAtIso: new Date(now - SHEET_SYNC_STALE_MS).toISOString() }, now), true);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'failed' }, now), true);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'pending', sheetSyncStartedAtIso: new Date(now - 1_000).toISOString() }, now), false);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'pending', sheetSyncStartedAtIso: new Date(now - SHEET_SYNC_STALE_MS).toISOString() }, now), true);
  assert.equal(isSheetSyncClaimable({ sheetSyncStatus: 'pending' }, now), true);
});

test('verified is the current terminal Sheet state while synced remains readable for old orders', () => {
  assert.equal(isSheetSyncVerified({ sheetSyncStatus: 'verified' }), true);
  assert.equal(isSheetSyncVerified({ sheetSyncStatus: 'synced' }), true);
  assert.equal(isSheetSyncVerified({ sheetSyncStatus: 'writing' }), false);
});

test('scan row date follows the primary scan event across days', () => {
  assert.equal(getScanEventDate({
    date: '2026-08-04',
    admin: { scannedAt: '2026-08-04T23:50:00' },
    packerScan: { scannedAt: '2026-08-05T00:10:00' },
  }), '2026-08-05');
  assert.equal(getScanEventDate({
    date: '2026-08-04',
    admin: { scannedAt: '2026-08-04T23:50:00' },
  }), '2026-08-04');
});

test('a rescan retries only an unsynced scan and keeps a synced order duplicate', () => {
  assert.equal(shouldReconcileSheetOnRescan({ admin: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'synced' }, 'admin'), false);
  assert.equal(shouldReconcileSheetOnRescan({ packerScan: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'synced' }, 'packerScan'), false);
  assert.equal(shouldReconcileSheetOnRescan({ admin: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'pending' }, 'admin'), true);
  assert.equal(shouldReconcileSheetOnRescan({ packerScan: { scannedAt: '2026-07-23T10:00:00' }, sheetSyncStatus: 'failed' }, 'packerScan'), true);
  assert.equal(shouldReconcileSheetOnRescan({ sheetSyncStatus: 'failed' }, 'admin'), false);
});

test('failed Sheet syncs are recovered before pending syncs', () => {
  const failed = [{ id: 'failed-1' }, { id: 'failed-2' }];
  const pending = [{ id: 'pending-1' }, { id: 'pending-2' }];
  assert.deepEqual(
    prioritizeSheetSyncCandidates({ failed, pending, maxRows: 3 }).map((item) => item.id),
    ['failed-1', 'failed-2', 'pending-1'],
  );
});

test('manual Sheet recovery includes synced orders when the selected scan exists', () => {
  assert.equal(shouldIncludeInManualSheetRecovery({
    code: 'TH123',
    sheetSyncStatus: 'synced',
    packerScan: { scannedAt: '2026-07-25T10:00:00' },
  }, 'packer'), true);
  assert.equal(shouldIncludeInManualSheetRecovery({
    code: 'TH123',
    sheetSyncStatus: 'synced',
    admin: { scannedAt: '2026-07-25T10:00:00' },
  }, 'packer'), false);
  assert.equal(shouldIncludeInManualSheetRecovery({
    code: 'TH123',
    sheetSyncStatus: 'synced',
    admin: { scannedAt: '2026-07-25T10:00:00' },
  }, 'admin'), true);
});

test('primary scans confirm before their background Marketplace lookup', async () => {
  const [source, appSource] = await Promise.all([
    readFile(new URL('./firebaseScans.js', import.meta.url), 'utf8'),
    readFile(new URL('../App.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /recordPackerScanPrimary\(\{ code, courier, date, time, user, packer = '', note = '' \}\)/);
  assert.match(source, /recordAdminScanPrimary\(\{ code, courier, date, time, user \}\)/);
  assert.doesNotMatch(source, /marketplaceMetadata/);
  assert.doesNotMatch(source, /findMarketplaceOrderByTracking/);
  assert.doesNotMatch(source, /findMarketplaceMetadataByTracking/);
  assert.doesNotMatch(source, /collection\(firestoreDb, 'marketplaceOrders'\)/);
  assert.doesNotMatch(appSource, /const \[firestoreUser, marketplaceOrder\] = await Promise\.all/);
  assert.ok(
    appSource.indexOf('const marketplaceOrderPromise = findMarketplaceOrderForScan(validation.code).catch(() => null);')
      > appSource.indexOf('const firestorePrimary = firestoreUser'),
    'Marketplace lookup must begin after Firestore primary confirmation starts',
  );
});

test('pending badge fallback stays capped and still reads the newest orders first', async () => {
  const source = await readFile(new URL('./firebaseScans.js', import.meta.url), 'utf8');
  const marker = "console.warn('Pending badge query failed; falling back to document-id order:', error);";
  const fallback = source.slice(source.indexOf(marker));

  // ต้องมีทั้งสองอย่าง: cap กัน quota และลำดับที่ทำให้ cap เก็บของใหม่ ไม่ใช่ของเก่า
  assert.ok(source.includes(marker), 'fallback marker missing');
  assert.match(fallback, /collectFirestorePages\(fetchPage\('docId'\)/);
  assert.match(fallback, /maxItems: PENDING_BADGE_SCAN_LIMIT/);
  assert.ok(source.includes("ordering === 'docId' ? [orderBy(documentId(), 'desc')]"), 'doc-id ordering missing');
});
