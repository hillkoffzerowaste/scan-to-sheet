import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const matchingPath = path.resolve(TEST_DIR, '../../apps-script/label-sync/Matching.gs');

function loadMatching() {
  if (!existsSync(matchingPath)) return {};
  const context = {};
  vm.runInNewContext(readFileSync(matchingPath, 'utf8'), context, { filename: matchingPath });
  return context.LabelMatching ?? {};
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Each result now also carries the labelKey it belongs to, so callers can pair outcomes
// back to their labels instead of trusting array position. These older assertions are
// about the outcome itself; the key is asserted directly in the pairing tests below.
function statuses(results) {
  return results.map(({ status, matchedRows, errorCode }) => ({ status, matchedRows, errorCode }));
}

test('overwrites column P for every same-platform row with the matched order ID', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  // Columns: M=tracking, N=platform, O=orderId, P=existing combined
  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', 'shopee', 'SHP-001', 'old'],
      ['', 'shopee', 'SHP-001', 'older'],
    ] },
  ], [{
    platform: 'shopee', orderId: 'SHP001', trackingId: '', combined: 'สมชาย | 12/3 กรุงเทพฯ',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'สมชาย | 12/3 กรุงเทพฯ' },
    { sheetName: '2026-07-27', rowNumber: 3, value: 'สมชาย | 12/3 กรุงเทพฯ' },
  ]);
  assert.deepEqual(statuses(result.results), [{ status: 'updated', matchedRows: 2, errorCode: '' }]);
});

test('does not use an unscoped order ID when different platforms share it', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', '', 'DUP-1', ''],
      ['', '', 'DUP-1', ''],
    ] },
  ], [{ platform: 'lazada', orderId: 'DUP1', trackingId: '', combined: 'A | B' }]));

  assert.deepEqual(result.updates, []);
  assert.deepEqual(statuses(result.results), [{ status: 'ambiguous', matchedRows: 0, errorCode: 'multiple_unscoped_rows' }]);
});

test('does not write a duplicate label when its recipient data conflicts', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [['', 'tiktok', '585225626528745423', '']] },
  ], [
    { platform: 'tiktok', orderId: '585225626528745423', trackingId: '', combined: 'คนแรก | ที่อยู่ A' },
    { platform: 'tiktok', orderId: '585225626528745423', trackingId: '', combined: 'คนสอง | ที่อยู่ B' },
  ]));

  assert.deepEqual(result.updates, []);
  assert.deepEqual(statuses(result.results), [{ status: 'ambiguous', matchedRows: 0, errorCode: 'conflicting_label_data' }]);
});

test('matches a Lazada label to a scoped sheet row', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', 'lazada', 'LZD-1117718175852180', ''],
    ] },
  ], [{
    platform: 'lazada',
    orderId: 'LZD1117718175852180',
    trackingId: '',
    combined: 'นางทดสอบ ระบบงาน | 73/1 หมู่ 13 ตำบลตัวอย่าง บ้านโป่ง ราชบุรี 70110',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'นางทดสอบ ระบบงาน | 73/1 หมู่ 13 ตำบลตัวอย่าง บ้านโป่ง ราชบุรี 70110' },
  ]);
  assert.deepEqual(statuses(result.results), [{ status: 'updated', matchedRows: 1, errorCode: '' }]);
});

test('matches a TikTok label to a scoped sheet row', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', 'tiktok', '585225626528745423', ''],
    ] },
  ], [{
    platform: 'tiktok',
    orderId: '585225626528745423',
    trackingId: '',
    combined: 'คุณทดสอบ ติ๊กต็อก | 75/6 ถนนชุมแสง ตำบลบ้านพรุ หาดใหญ่ สงขลา 90250',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'คุณทดสอบ ติ๊กต็อก | 75/6 ถนนชุมแสง ตำบลบ้านพรุ หาดใหญ่ สงขลา 90250' },
  ]);
  assert.deepEqual(statuses(result.results), [{ status: 'updated', matchedRows: 1, errorCode: '' }]);
});

test('reports unmatched when a Lazada label has no sheet row', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', 'shopee', 'SHP-001', ''],
    ] },
  ], [{
    platform: 'lazada',
    orderId: 'LZD999',
    trackingId: '',
    combined: 'ใครสักคน | ที่อยู่หนึ่ง',
  }]));

  assert.deepEqual(result.updates, []);
  assert.deepEqual(statuses(result.results), [{ status: 'unmatched', matchedRows: 0, errorCode: 'order_not_found' }]);
});

test('matches a TikTok label even when the sheet row omits the platform', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', '', '585225626528745423', ''],
    ] },
  ], [{
    platform: 'tiktok',
    orderId: '585225626528745423',
    trackingId: '',
    combined: 'คนเดียว | ที่อยู่เดียว',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'คนเดียว | ที่อยู่เดียว' },
  ]);
  assert.deepEqual(statuses(result.results), [{ status: 'updated', matchedRows: 1, errorCode: '' }]);
});

test('matches a Shopee label by tracking ID (tracking-first) even when order ID differs', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  // Sheet row: tracking='B899B00007L01', platform='shopee', orderId='wrong-order-id'
  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['B899B00007L01', 'shopee', 'wrong-order-id', ''],
    ] },
  ], [{
    platform: 'shopee',
    orderId: '260726P6WBVFGG',
    trackingId: 'B899B00007L01',
    combined: 'ผู้รับ | ที่อยู่ tracking match',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'ผู้รับ | ที่อยู่ tracking match' },
  ]);
  assert.deepEqual(statuses(result.results), [{ status: 'updated', matchedRows: 1, errorCode: '' }]);
});

test('falls back to order ID matching when tracking ID does not match any row', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', 'shopee', '260726P6WBVFGG', ''],
    ] },
  ], [{
    platform: 'shopee',
    orderId: '260726P6WBVFGG',
    trackingId: 'NO_MATCH_TRACKING',
    combined: 'ผู้รับ | ที่อยู่ order fallback',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'ผู้รับ | ที่อยู่ order fallback' },
  ]);
  assert.deepEqual(statuses(result.results), [{ status: 'updated', matchedRows: 1, errorCode: '' }]);
});

test('matches a TikTok label by tracking ID from unscoped row (no platform in sheet)', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  // Sheet row: tracking='JTTH201795097265', platform='', orderId=''
  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['JTTH201795097265', '', '', ''],
    ] },
  ], [{
    platform: 'tiktok',
    orderId: '585225626528745423',
    trackingId: 'JTTH201795097265',
    combined: 'ผู้รับ TikTok | ที่อยู่ tracking unscoped',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'ผู้รับ TikTok | ที่อยู่ tracking unscoped' },
  ]);
  assert.deepEqual(statuses(result.results), [{ status: 'updated', matchedRows: 1, errorCode: '' }]);
});

test('every result names the label it belongs to', () => {
  const matching = loadMatching();

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [['', 'shopee', 'SHP-001', '']] },
  ], [
    { platform: 'shopee', orderId: 'SHP001', trackingId: '', combined: 'A | B' },
    { platform: 'lazada', orderId: 'LZD999', trackingId: '', combined: 'C | D' },
  ]));

  assert.deepEqual(result.results.map((entry) => entry.labelKey), ['shopee|SHP001', 'lazada|LZD999']);
});

test('pairs outcomes back to labels by key when duplicates collapse the result list', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.resultsByLabel, 'function');

  // Two labels for the same order (one parcel photographed twice) plus one order that is
  // not on any sheet yet. matchLabels dedupes the first two, so it returns 2 results for
  // 3 labels — pairing by array index would report the unmatched label's outcome against
  // the duplicate, and leave the last label with 'missing_match_result'.
  const labels = [
    { platform: 'shopee', orderId: 'SHP001', trackingId: '', combined: 'A | B' },
    { platform: 'shopee', orderId: 'SHP-001', trackingId: '', combined: 'A | B' },
    { platform: 'lazada', orderId: 'LZD999', trackingId: '', combined: 'C | D' },
  ];
  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [['', 'shopee', 'SHP-001', '']] },
  ], labels));

  assert.equal(result.results.length, 2, 'duplicates collapse before matching');

  const paired = plain(matching.resultsByLabel(labels, result.results));
  assert.deepEqual(paired.map((entry) => [entry.label.orderId, entry.status, entry.errorCode]), [
    ['SHP001', 'updated', ''],
    ['SHP-001', 'updated', ''],
    ['LZD999', 'unmatched', 'order_not_found'],
  ]);
});

test('reports a label that carries neither platform nor order id instead of shifting the rest', () => {
  const matching = loadMatching();

  const labels = [
    { platform: '', orderId: '', trackingId: '', combined: 'ผู้รับ | ที่อยู่' },
    { platform: 'shopee', orderId: 'SHP001', trackingId: '', combined: 'A | B' },
  ];
  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [['', 'shopee', 'SHP-001', '']] },
  ], labels));

  const paired = plain(matching.resultsByLabel(labels, result.results));
  assert.deepEqual(paired.map((entry) => [entry.status, entry.errorCode]), [
    ['skipped', 'incomplete_label'],
    ['updated', ''],
  ]);
});
