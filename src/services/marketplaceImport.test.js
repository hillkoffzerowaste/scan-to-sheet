import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildSheetBackfillUpdates, classifyLateOrder, groupMarketplaceRows, isCompleteScanOrder,
  marketplaceMetadataChanged, parseMarketplaceRows, validateMarketplaceIdentifier,
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
  const rows = [['orderNumber', 'sellerSku', 'trackingCode'], ['L1', 'SKU-A', 'LEX123'], ['L1', 'SKU-B', 'LEX123']];
  assert.deepEqual(groupMarketplaceRows(parseMarketplaceRows(rows))[0].marketplaceSkus, ['SKU-A', 'SKU-B']);
});

test('parses Shopee headers', () => {
  const rows = [[
    'หมายเลขคำสั่งซื้อ', 'เลขอ้างอิง SKU (SKU Reference No.)', '*หมายเลขติดตามพัสดุ',
    'สถานะการสั่งซื้อ', 'วันที่คาดว่าจะทำการจัดส่งสินค้า',
  ], ['S1', 'SKU-S', 'TH123', 'ที่ต้องจัดส่ง', '2026-07-17 23:59']];
  const parsed = parseMarketplaceRows(rows)[0];
  assert.equal(parsed.platform, 'shopee');
  assert.equal(parsed.sellerOrderStatus, 'ที่ต้องจัดส่ง');
  assert.equal(parsed.expectedShipAt, '2026-07-17 23:59');
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
  const rows = [['\uFEFFOrder ID', 'Seller SKU', 'Tracking ID'], ['T1\t', 'SKU-T', 'JT123\t']];
  assert.deepEqual(parseMarketplaceRows(rows)[0], {
    platform: 'tiktok', orderId: 'T1', sku: 'SKU-T', trackingNo: 'JT123',
    sellerOrderStatus: '', expectedShipAt: '',
  });
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

test('builds only N, O and R updates for a matching historical row', () => {
  const rows = [Array(23).fill('')];
  rows[0][12] = ' th-123 ';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [{
    platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-A', 'SKU-B'],
  }]);
  assert.equal(result.matchedRows, 1);
  assert.deepEqual(result.data.map((item) => item.range), ["'2026-07-16'!N2", "'2026-07-16'!O2", "'2026-07-16'!R2"]);
});

test('backfills SKU by an unambiguous Order ID when tracking differs', () => {
  const rows = [Array(23).fill('')];
  rows[0][13] = 'shopee';
  rows[0][14] = 'ORDER-1';
  rows[0][17] = '';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [{
    platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-A'],
  }]);

  assert.equal(result.matchedRows, 1);
  assert.deepEqual(result.data, [{ range: "'2026-07-16'!R2", values: [['SKU-A']] }]);
});

test('does not backfill by Order ID when several imports could match', () => {
  const rows = [Array(23).fill('')];
  rows[0][13] = 'shopee';
  rows[0][14] = 'ORDER-1';
  const result = buildSheetBackfillUpdates('2026-07-16', rows, [
    { platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: 'TH123', marketplaceSkus: ['SKU-A'] },
    { platform: 'shopee', orderId: 'ORDER-1', normalizedTrackingNo: 'TH456', marketplaceSkus: ['SKU-B'] },
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
  assert.ok(groups.every((group) => group.platform === 'tiktok'));
  assert.ok(groups.every((group) => group.orderId && group.trackingNo && group.marketplaceSkus.length > 0));
});

const shopeeXlsxPath = path.join(homedir(), 'Downloads', 'Order.toship.20260715_20260716.xlsx');
test('parses expected ship metadata from the real Shopee export', { skip: !existsSync(shopeeXlsxPath) }, async () => {
  const file = await readFile(shopeeXlsxPath);
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const groups = groupMarketplaceRows(parseMarketplaceRows(await parseXlsxArrayBuffer(buffer)));
  assert.ok(groups.length > 0);
  assert.ok(groups.every((group) => group.expectedShipAt));
  assert.ok(groups.every((group) => group.sellerOrderStatus));
});
