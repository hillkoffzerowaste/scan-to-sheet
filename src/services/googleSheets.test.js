import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketplaceFormattingRequests,
  findCancellationRow,
  getDailySheetPropertiesForMarketplaceBackfill,
  parseAppendUpdatedRange,
} from './googleSheets.js';

test('parseAppendUpdatedRange accepts one A:W row on the expected sheet', () => {
  assert.equal(parseAppendUpdatedRange("'2026-07-18'!A43:W43", '2026-07-18'), 43);
  assert.equal(parseAppendUpdatedRange('2026-07-18!$A$9:$W$9', '2026-07-18'), 9);
});

test('parseAppendUpdatedRange rejects shifted or multi-row appends', () => {
  assert.throws(() => parseAppendUpdatedRange("'2026-07-18'!O42:AK42", '2026-07-18'), /outside/);
  assert.throws(() => parseAppendUpdatedRange("'2026-07-18'!A42:W43", '2026-07-18'), /outside/);
});

test('findCancellationRow matches the previous-day packer row before an admin-only row', () => {
  const rows = [
    { no: 1, courier: 'Kerry', code: '', adminCode: 'TH123' },
    { no: 2, courier: 'Kerry', code: 'TH123', adminCode: '' },
    { no: 3, courier: 'Flash', code: 'TH123', adminCode: '' },
  ];

  assert.deepEqual(
    findCancellationRow(rows, { courier: 'Kerry', code: ' th123 ' }),
    rows[1],
  );
});

test('buildMarketplaceFormattingRequests colors platform cells with readable brand contrast', () => {
  const requests = buildMarketplaceFormattingRequests(123);

  assert.equal(requests.length, 3);
  const rules = requests.map((request) => request.addConditionalFormatRule.rule);
  const marketplaceRange = {
    sheetId: 123,
    startRowIndex: 1,
    startColumnIndex: 13,
    endColumnIndex: 14,
  };

  for (const rule of rules) {
    assert.deepEqual(rule.ranges, [marketplaceRange]);
    assert.equal(rule.booleanRule.condition.type, 'CUSTOM_FORMULA');
    assert.deepEqual(rule.booleanRule.format.textFormat, {
      foregroundColor: { red: 1, green: 1, blue: 1 },
      bold: true,
    });
    assert.equal(rule.booleanRule.format.horizontalAlignment, undefined);
  }

  assert.match(rules[0].booleanRule.condition.values[0].userEnteredValue, /shopee/);
  assert.deepEqual(rules[0].booleanRule.format.backgroundColor, { red: 0.933, green: 0.302, blue: 0.176 });
  assert.match(rules[1].booleanRule.condition.values[0].userEnteredValue, /lazada/);
  assert.deepEqual(rules[1].booleanRule.format.backgroundColor, { red: 0.102, green: 0.451, blue: 0.910 });
  assert.match(rules[2].booleanRule.condition.values[0].userEnteredValue, /tiktok/);
  assert.deepEqual(rules[2].booleanRule.format.backgroundColor, { red: 0, green: 0, blue: 0 });
});

test('getDailySheetPropertiesForMarketplaceBackfill includes today and conflict tabs', () => {
  const sheets = [
    { title: '2026-07-26', sheetId: 1 },
    { title: '2026-07-25', sheetId: 2 },
    { title: '2026-07-26_conflict1', sheetId: 3 },
    { title: 'Late Orders', sheetId: 4 },
  ];

  assert.deepEqual(
    getDailySheetPropertiesForMarketplaceBackfill(sheets).map((sheet) => sheet.title),
    ['2026-07-26', '2026-07-25', '2026-07-26_conflict1'],
  );
});
