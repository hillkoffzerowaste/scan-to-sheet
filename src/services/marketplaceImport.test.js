import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSheetBackfillUpdates, groupMarketplaceRows, parseMarketplaceRows } from './marketplaceImport.js';

test('parses and groups Lazada rows', () => {
  const rows = [['orderNumber', 'sellerSku', 'trackingCode'], ['L1', 'SKU-A', 'LEX123'], ['L1', 'SKU-B', 'LEX123']];
  assert.deepEqual(groupMarketplaceRows(parseMarketplaceRows(rows))[0].marketplaceSkus, ['SKU-A', 'SKU-B']);
});

test('parses Shopee headers', () => {
  const rows = [['หมายเลขคำสั่งซื้อ', 'เลขอ้างอิง SKU (SKU Reference No.)', '*หมายเลขติดตามพัสดุ'], ['S1', 'SKU-S', 'TH123']];
  assert.equal(parseMarketplaceRows(rows)[0].platform, 'shopee');
});

test('parses TikTok BOM headers and trims tab suffixes', () => {
  const rows = [['\uFEFFOrder ID', 'Seller SKU', 'Tracking ID'], ['T1\t', 'SKU-T', 'JT123\t']];
  assert.deepEqual(parseMarketplaceRows(rows)[0], { platform: 'tiktok', orderId: 'T1', sku: 'SKU-T', trackingNo: 'JT123' });
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
