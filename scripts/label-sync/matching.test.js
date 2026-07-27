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

test('overwrites column P for every same-platform row with the matched order ID', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['shopee', 'SHP-001', 'old'],
      ['shopee', 'SHP-001', 'older'],
    ] },
  ], [{
    platform: 'shopee', orderId: 'SHP001', combined: 'สมชาย | 12/3 กรุงเทพฯ',
  }]));

  assert.deepEqual(result.updates, [
    { sheetName: '2026-07-27', rowNumber: 2, value: 'สมชาย | 12/3 กรุงเทพฯ' },
    { sheetName: '2026-07-27', rowNumber: 3, value: 'สมชาย | 12/3 กรุงเทพฯ' },
  ]);
  assert.deepEqual(result.results, [{ status: 'updated', matchedRows: 2, errorCode: '' }]);
});

test('does not use an unscoped order ID when different platforms share it', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [
      ['', 'DUP-1', ''],
      ['', 'DUP-1', ''],
    ] },
  ], [{ platform: 'lazada', orderId: 'DUP1', combined: 'A | B' }]));

  assert.deepEqual(result.updates, []);
  assert.deepEqual(result.results, [{ status: 'ambiguous', matchedRows: 0, errorCode: 'multiple_unscoped_rows' }]);
});

test('does not write a duplicate label when its recipient data conflicts', () => {
  const matching = loadMatching();
  assert.equal(typeof matching.matchLabels, 'function');

  const result = plain(matching.matchLabels([
    { sheetName: '2026-07-27', values: [['tiktok', '585225626528745423', '']] },
  ], [
    { platform: 'tiktok', orderId: '585225626528745423', combined: 'คนแรก | ที่อยู่ A' },
    { platform: 'tiktok', orderId: '585225626528745423', combined: 'คนสอง | ที่อยู่ B' },
  ]));

  assert.deepEqual(result.updates, []);
  assert.deepEqual(result.results, [{ status: 'ambiguous', matchedRows: 0, errorCode: 'conflicting_label_data' }]);
});
