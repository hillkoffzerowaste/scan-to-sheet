import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSheetBackfillUpdates, classifyLateOrder, groupMarketplaceRows, isCompleteScanOrder,
  marketplaceMetadataChanged, normalizeMarketplaceOrderDate, normalizeMarketplaceShipDeadline,
  parseMarketplaceRows,
  validateMarketplaceIdentifier,
} from './marketplaceImport.js';
import { parseXlsxArrayBuffer } from './xlsxImport.js';
import { buildDailyRowUpdateData, marketplaceSkusText, validateScanCode } from './googleSheets.js';

test('accepts both KEX Lazada barcode prefixes and rejects near misses', () => {
  assert.equal(validateScanCode('KEX Lazada', 'KEXD0LM0003766710').ok, true);
  assert.equal(validateScanCode('KEX Lazada', 'KEXDOLM000376671').ok, true);
  assert.equal(validateScanCode('KEX Lazada', 'KEXLM12345678').ok, true);
  assert.equal(validateScanCode('KEX Lazada', 'KEX0LM12345678').ok, false);
  assert.equal(validateScanCode('KEX Lazada', 'KEXDLM12345678').ok, false);
});

test('accepts a non-empty special tracking value only when the operator opts out of courier validation', () => {
  assert.equal(validateScanCode('J&T', 'SPECIAL-001').ok, false);
  assert.equal(validateScanCode('J&T', 'SPECIAL-001', { allowAnyFormat: true }).ok, true);
  assert.equal(validateScanCode('J&T', '   ', { allowAnyFormat: true }).ok, false);
});

test('rejects scanner fragments even when special tracking format is enabled', () => {
  const validation = validateScanCode('Flash', 'TH4KY7D', { allowAnyFormat: true });
  assert.equal(validation.ok, false);
  assert.equal(validation.code, 'TH4KY7D');
});

test('rejects short tracking values during marketplace import parsing', () => {
  assert.throws(
    () => parseMarketplaceRows([
      ['orderNumber', 'sellerSku', 'trackingCode', 'createTime'],
      ['ORDER-1', 'SKU-1', 'TH4KY7D', '2026-09-03 10:00'],
    ]),
    /เลขพัสดุสั้นเกินไป/,
  );
});

test('preserves manual Buyer Name when updating an existing scan row', () => {
  const row = Array.from({ length: 23 }, (_, index) => `cell-${index}`);
  const data = buildDailyRowUpdateData('2026-07-17', 9, row);

  assert.deepEqual(data.map((item) => item.range), ["'2026-07-17'!A9:O9", "'2026-07-17'!Q9:W9"]);
  assert.deepEqual(data[0].values, [row.slice(0, 15)]);
  assert.deepEqual(data[1].values, [row.slice(16)]);
});

test('writes imported marketplaceSkus when scan metadata has no items array', () => {
  assert.equal(marketplaceSkusText({ marketplaceSkus: ['RB-HK-0359', 'EQ-CC-0005'] }), 'RB-HK-0359 | EQ-CC-0005');
});

test('parses and groups Lazada rows', () => {
  const rows = [['orderNumber', 'sellerSku', 'trackingCode'], ['L1', 'SKU-A', 'LEX12345678'], ['L1', 'SKU-B', 'LEX12345678']];
  assert.deepEqual(groupMarketplaceRows(parseMarketplaceRows(rows))[0].marketplaceSkus, ['SKU-A', 'SKU-B']);
});

test('reads Lazada itemName and uses source rows for item quantity', () => {
  const rows = [
    ['orderNumber', 'sellerSku', 'trackingCode', 'itemName'],
    ['L1', 'SKU-A', 'LEX12345678', 'Coffee Drip Bag'],
    ['L1', 'SKU-A', 'LEX12345678', 'Coffee Drip Bag'],
  ];
  const group = groupMarketplaceRows(parseMarketplaceRows(rows))[0];

  assert.equal(parseMarketplaceRows(rows)[0].itemName, 'Coffee Drip Bag');
  assert.equal(group.sourceRowCount, 2);
  assert.deepEqual(group.items, [{ name: 'Coffee Drip Bag', sku: 'SKU-A', quantity: '' }]);

  const sheetRows = [Array(23).fill('')];
  sheetRows[0][12] = 'LEX12345678';
  sheetRows[0][13] = 'lazada';
  const result = buildSheetBackfillUpdates('2026-07-16', sheetRows, [group]);
  assert.deepEqual(result.data.at(-1), {
    range: "'2026-07-16'!S2",
    values: [[2]],
  });
});

test('parses Shopee headers', () => {
  const rows = [[
    'หมายเลขคำสั่งซื้อ', 'เลขอ้างอิง SKU (SKU Reference No.)', '*หมายเลขติดตามพัสดุ',
    'สถานะการสั่งซื้อ', 'วันที่คาดว่าจะทำการจัดส่งสินค้า',
  ], ['S1', 'SKU-S', 'TH1234567890', 'ที่ต้องจัดส่ง', '2026-07-17 23:59']];
  const parsed = parseMarketplaceRows(rows)[0];
  assert.equal(parsed.platform, 'shopee');
  assert.equal(parsed.sellerOrderStatus, 'ที่ต้องจัดส่ง');
  // Normalized to seconds like orderedAt, so the late/on-time comparison is a sortable string
  // comparison rather than whatever shape the seller happened to export.
  assert.equal(parsed.expectedShipAt, '2026-07-17 23:59:00');
});

test('a ship deadline is normalized whatever shape the seller exported', () => {
  // The bug: expectedShipAt was stored verbatim but compared with `<` against a Bangkok
  // "YYYY-MM-DD HH:mm" string, so any non-ISO export compared as nonsense and the late verdict
  // was arbitrary.
  assert.equal(normalizeMarketplaceShipDeadline('2026-08-26 09:30'), '2026-08-26 09:30:00');
  assert.equal(normalizeMarketplaceShipDeadline('26/08/2026 09:30:15'), '2026-08-26 09:30:15');
  assert.equal(normalizeMarketplaceShipDeadline('26 Aug 2026 09:30'), '2026-08-26 09:30:00');
  // A whole-day deadline resolves to the end of that day: a parcel due "26 Aug" is not late
  // at 09:00 on the 26th, which is what a bare date compared as text used to say.
  assert.equal(normalizeMarketplaceShipDeadline('2026-08-26'), '2026-08-26 23:59:59');
  assert.equal(normalizeMarketplaceShipDeadline('26/08/2026'), '2026-08-26 23:59:59');
  assert.equal(normalizeMarketplaceShipDeadline('26 Aug 2026'), '2026-08-26 23:59:59');
  assert.equal(normalizeMarketplaceShipDeadline('ไม่ระบุ'), '');
  assert.equal(normalizeMarketplaceShipDeadline(''), '');
});

test('a non-ISO ship deadline is classified by date, not by text order', () => {
  const now = new Date('2026-08-26T02:00:00Z'); // 09:00 Bangkok
  // '26 Aug 2026' sorts below every '2026-…' string, so this used to read as overdue.
  assert.equal(classifyLateOrder({ scanned: false, expectedShipAt: '26 Aug 2026' }, now).key, 'due_today');
  assert.equal(classifyLateOrder({ scanned: false, expectedShipAt: '25/08/2026' }, now).key, 'overdue');
  assert.equal(classifyLateOrder({ scanned: false, expectedShipAt: '27/08/2026' }, now).key, 'future');
  assert.equal(classifyLateOrder({ scanned: false, expectedShipAt: 'ไม่ระบุ' }, now).key, 'unknown');
});

test('accepts an order with SKU before its tracking number is assigned', () => {
  const rows = [[
    'หมายเลขคำสั่งซื้อ', 'เลขอ้างอิง SKU (SKU Reference No.)', '*หมายเลขติดตามพัสดุ',
  ], ['260717VGBPF7AW', 'SY-HK-0024_2', '']];
  const groups = groupMarketplaceRows(parseMarketplaceRows(rows));

  assert.equal(groups.length, 1);
  assert.equal(groups[0].orderId, '260717VGBPF7AW');
  assert.equal(groups[0].normalizedTrackingNo, '');
  assert.deepEqual(groups[0].marketplaceSkus, ['SY-HK-0024_2']);
});

test('parses TikTok BOM headers and trims tab suffixes', () => {
  const rows = [['\uFEFFOrder ID', 'Seller SKU', 'Tracking ID'], ['T1\t', 'SKU-T', 'JT12345678\t']];
  assert.deepEqual(parseMarketplaceRows(rows)[0], {
    platform: 'tiktok', orderId: 'T1', sku: 'SKU-T', itemName: '', quantity: '', trackingNo: 'JT12345678',
    sellerOrderStatus: '', expectedShipAt: '', orderedAt: '',
  });
});

test('retains product names and quantities from Seller exports with SKU', () => {
  const rows = [[
    'Order ID', 'Seller SKU', 'Tracking ID', 'Product Name', 'Quantity',
  ], ['T1', 'SKU-T', 'JT12345678', 'Coffee Drip Bag', '2']];
  const group = groupMarketplaceRows(parseMarketplaceRows(rows))[0];
  assert.deepEqual(group.items, [{ name: 'Coffee Drip Bag', sku: 'SKU-T', quantity: 2 }]);
  assert.deepEqual(group.marketplaceSkus, ['SKU-T']);
});

test('classifies Late Orders in Bangkok without affecting identifiers', () => {
  const now = new Date('2026-07-17T01:00:00Z');
  assert.equal(classifyLateOrder({ scanned: true, expectedShipAt: '2026-07-16 23:59' }, now).key, 'scanned');
  assert.equal(classifyLateOrder({ scanned: false, expectedShipAt: '2026-07-16 23:59' }, now).key, 'overdue');
  assert.equal(classifyLateOrder({ scanned: false, expectedShipAt: '2026-07-17 23:59' }, now).key, 'due_today');
  assert.equal(classifyLateOrder({ scanned: false, expectedShipAt: '2026-07-18 23:59' }, now).key, 'future');
});

test('marks Late Orders green only after both admin and packer scans', () => {
  assert.equal(isCompleteScanOrder({
    status: 'pending', admin: { scannedAt: '2026-07-17T08:00:00' }, packerScan: null,
  }), false);
  assert.equal(isCompleteScanOrder({
    status: 'packer_scanned', admin: null, packerScan: { scannedAt: '2026-07-17T08:30:00' },
  }), false);
  assert.equal(isCompleteScanOrder({
    status: 'matched', admin: { scannedAt: '2026-07-17T08:00:00' }, packerScan: { scannedAt: '2026-07-17T08:30:00' },
  }), true);
  assert.equal(isCompleteScanOrder({ status: 'matched' }), true);
});

test('updates duplicate marketplace metadata when SKU or legacy source differs', () => {
  const canonical = {
    trackingNo: 'TH123', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-A'],
    sellerOrderStatus: 'ready', expectedShipAt: '2026-07-17 23:59', importSource: 'web_upload',
  };
  assert.equal(marketplaceMetadataChanged({ ...canonical, marketplaceSkus: ['SKU-A'] }, canonical), false);
  assert.equal(marketplaceMetadataChanged({ ...canonical, marketplaceSkus: [] }, canonical), true);
  assert.equal(marketplaceMetadataChanged({ ...canonical, importSource: undefined }, canonical), true);
  assert.equal(marketplaceMetadataChanged({ ...canonical, trackingNo: 'TH999' }, canonical), true);
});

test('rejects scientific notation and unsafe numeric marketplace identifiers', () => {
  assert.throws(
    () => parseMarketplaceRows([['Order ID', 'Seller SKU', 'Tracking ID'], ['5.85049E+17', 'SKU-1', 'JT123']]),
    /แถว 2.*เลขคำสั่งซื้อ.*5\.85049E\+17/,
  );
  assert.throws(
    () => validateMarketplaceIdentifier(585049777788585346, {
      platform: 'tiktok', rowNumber: 3, field: 'เลขคำสั่งซื้อ',
    }),
    /แถว 3.*เลขคำสั่งซื้อ/,
  );
});

test('accepts long identifiers stored as text and normal alphanumeric values', () => {
  assert.equal(validateMarketplaceIdentifier('585049777788585346', {
    platform: 'tiktok', rowNumber: 3, field: 'เลขคำสั่งซื้อ',
  }), '585049777788585346');
  assert.equal(validateMarketplaceIdentifier('JTTH201519776802', {
    platform: 'tiktok', rowNumber: 3, field: 'เลขพัสดุ',
  }), 'JTTH201519776802');
  assert.equal(validateMarketplaceIdentifier('IG-HK-0653_1', {
    platform: 'tiktok', rowNumber: 3, field: 'SKU',
  }), 'IG-HK-0653_1');
});

test('backfills product names, SKU and quantities into existing Sheet columns', () => {
  const rows = [Array(23).fill('')];
  rows[0][12] = ' th-123 ';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [{
    platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-A', 'SKU-B'],
    items: [{ name: 'Coffee', sku: 'SKU-A', quantity: 2 }, { name: 'Tea', sku: 'SKU-B', quantity: 1 }],
  }]);
  assert.equal(result.matchedRows, 1);
  assert.deepEqual(result.data.map((item) => item.range), ["'2026-07-16'!N2", "'2026-07-16'!O2", "'2026-07-16'!Q2", "'2026-07-16'!R2", "'2026-07-16'!S2"]);
});

test('backfills SKU by Order ID only when imported tracking is blank', () => {
  const rows = [Array(23).fill('')];
  rows[0][13] = 'shopee';
  rows[0][14] = 'ORDER-1';
  rows[0][17] = '';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [{
    platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: '', marketplaceSkus: ['SKU-A'],
  }]);

  assert.equal(result.matchedRows, 1);
  assert.deepEqual(result.data, [{ range: "'2026-07-16'!R2", values: [['SKU-A']] }]);
});

test('does not backfill by Order ID when imported tracking differs', () => {
  const rows = [Array(23).fill('')];
  rows[0][12] = 'TH999';
  rows[0][13] = 'shopee';
  rows[0][14] = 'ORDER-1';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [{
    platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-A'],
  }]);

  assert.equal(result.matchedRows, 0);
  assert.deepEqual(result.data, []);
});

test('does not match duplicate tracking across platforms without a sheet platform', () => {
  const rows = [Array(23).fill('')];
  rows[0][12] = 'TH123';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [
    { platform: 'shopee', orderId: 'ORDER-S', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-S'] },
    { platform: 'tiktok', orderId: 'ORDER-T', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-T'] },
  ]);

  assert.equal(result.matchedRows, 0);
  assert.deepEqual(result.data, []);
});

test('uses platform to disambiguate duplicate tracking across platforms', () => {
  const rows = [Array(23).fill('')];
  rows[0][12] = 'TH123';
  rows[0][13] = 'tiktok';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [
    { platform: 'shopee', orderId: 'ORDER-S', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-S'] },
    { platform: 'tiktok', orderId: 'ORDER-T', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-T'] },
  ]);

  assert.equal(result.matchedRows, 1);
  assert.deepEqual(result.data, [
    { range: "'2026-07-16'!O2", values: [['ORDER-T']] },
    { range: "'2026-07-16'!R2", values: [['SKU-T']] },
  ]);
});

test('does not backfill by Order ID when several imports could match', () => {
  const rows = [Array(23).fill('')];
  rows[0][13] = 'shopee';
  rows[0][14] = 'ORDER-1';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [
    { platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: '', marketplaceSkus: ['SKU-A'] },
    { platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: '', marketplaceSkus: ['SKU-B'] },
  ]);

  assert.equal(result.matchedRows, 0);
  assert.deepEqual(result.data, []);
});

const tiktokXlsxPath = path.join(homedir(), 'Downloads', 'ที่จะจัดส่ง คำสั่งซื้อ-2026-07-16-18_18.xlsx');
test('parses the real TikTok Seller Center xlsx export', { skip: !existsSync(tiktokXlsxPath) }, async () => {
  const file = await readFile(tiktokXlsxPath);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const rows = await parseXlsxArrayBuffer(buffer);
  const groups = groupMarketplaceRows(parseMarketplaceRows(rows));
  assert.equal(rows[0].length, 65);
  assert.ok(groups.length > 0);
  const trackedGroups = groups.filter((group) => group.normalizedTrackingNo);
  assert.ok(trackedGroups.every((group) => group.platform === 'tiktok'));
  assert.ok(trackedGroups.every((group) => group.orderId && group.trackingNo && group.marketplaceSkus.length > 0));
});

const shopeeXlsxPath = path.join(homedir(), 'Downloads', 'Order.toship.20260715_20260716.xlsx');
test('parses expected ship metadata from the real Shopee export', { skip: !existsSync(shopeeXlsxPath) }, async () => {
  const file = await readFile(shopeeXlsxPath);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const groups = groupMarketplaceRows(parseMarketplaceRows(await parseXlsxArrayBuffer(buffer)));
  assert.ok(groups.length > 0);
  const trackedGroups = groups.filter((group) => group.normalizedTrackingNo);
  assert.ok(trackedGroups.every((group) => group.expectedShipAt));
  assert.ok(trackedGroups.every((group) => group.sellerOrderStatus));
});

test('normalizes each platform order-date format to one sortable timestamp', () => {
  assert.equal(normalizeMarketplaceOrderDate('27/07/2026 20:33:12'), '2026-07-27 20:33:12');
  assert.equal(normalizeMarketplaceOrderDate('27 Jul 2026 21:18'), '2026-07-27 21:18:00');
  assert.equal(normalizeMarketplaceOrderDate('2026-07-26 00:06'), '2026-07-26 00:06:00');
});

test('reads a US-locale M/D/Y export instead of inventing month 27', () => {
  // D/M/Y and M/D/Y are indistinguishable until one slot exceeds 12.
  assert.equal(normalizeMarketplaceOrderDate('07/27/2026 20:33:12'), '2026-07-27 20:33:12');
  assert.equal(normalizeMarketplaceOrderDate('27/07/2026 20:33:12'), '2026-07-27 20:33:12');
  // Genuinely ambiguous dates keep the D/M/Y reading the Thai exports use.
  assert.equal(normalizeMarketplaceOrderDate('05/07/2026 08:00:00'), '2026-07-05 08:00:00');
});

test('treats an unparseable or impossible order date as missing, never as newest', () => {
  // Returning raw text would sort it above every ISO timestamp, letting one bad row
  // monopolise the capped import window instead of being reported as missing.
  for (const value of ['not a date', '31/31/2026 10:00', '2026-13-01 10:00', '2026-07-26 25:00']) {
    assert.equal(normalizeMarketplaceOrderDate(value), '', `expected "" for ${value}`);
  }
  const sorted = ['', '2026-07-26 00:06:00'].sort((a, b) => (a === b ? 0 : (a < b ? 1 : -1)));
  assert.equal(sorted[0], '2026-07-26 00:06:00');
});

async function loadGroupsFromXlsx(filePath) {
  const file = await readFile(filePath);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  return groupMarketplaceRows(parseMarketplaceRows(await parseXlsxArrayBuffer(buffer)));
}

const tiktokOrderedAtPath = path.join(homedir(), 'Downloads', 'ทั้งหมด คำสั่งซื้อ-2026-07-27-22_10.xlsx');
test('parses order-placed time from a real TikTok "Created Time" export', { skip: !existsSync(tiktokOrderedAtPath) }, async () => {
  const groups = await loadGroupsFromXlsx(tiktokOrderedAtPath);
  assert.ok(groups.length > 0);
  const tracked = groups.filter((group) => group.normalizedTrackingNo);
  assert.ok(tracked.every((group) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(group.orderedAt)));
});

const lazadaOrderedAtPath = path.join(homedir(), 'Downloads', '95866af2b2592ed17b00f15d106e4c8e.xlsx');
test('parses order-placed time from a real Lazada "createTime" export', { skip: !existsSync(lazadaOrderedAtPath) }, async () => {
  const groups = await loadGroupsFromXlsx(lazadaOrderedAtPath);
  assert.ok(groups.length > 0);
  const tracked = groups.filter((group) => group.normalizedTrackingNo);
  assert.ok(tracked.every((group) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(group.orderedAt)));
});

const shopeeOrderedAtPath = path.join(homedir(), 'Downloads', 'Order.all.20260726_20260727.xlsx');
test('parses order-placed time from a real Shopee "วันที่ทำการสั่งซื้อ" export', { skip: !existsSync(shopeeOrderedAtPath) }, async () => {
  const groups = await loadGroupsFromXlsx(shopeeOrderedAtPath);
  assert.ok(groups.length > 0);
  const tracked = groups.filter((group) => group.normalizedTrackingNo);
  assert.ok(tracked.every((group) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(group.orderedAt)));
});
