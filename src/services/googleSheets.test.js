import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketplaceFormattingRequests,
  buildConditionalFormatReconciliationRequests,
  buildStatusValidationRequest,
  appendScanGoogle,
  batchAppendScanGoogle,
  buildDailyDataTypeFormattingRequests,
  buildDailyRowDataTypeFormattingRequests,
  buildDailyRowUpdateData,
  findCancellationRow,
  getDailySheetPropertiesForMarketplaceBackfill,
  apiFetch,
} from './googleSheets.js';

test('buildDailyRowUpdateData restores native RAW types after formatted-value reads', () => {
  const row = Array(23).fill('');
  row[0] = '117';
  row[1] = ' 8 ';
  row[2] = '2026-08-26';
  row[3] = '11:21:22';
  row[5] = 66857226387700;
  row[10] = '2026-08-25';
  row[11] = '9:47:52';
  row[12] = 66857221393746;

  const [primaryRange] = buildDailyRowUpdateData('2026-08-26', 118, row);
  const updatedRow = primaryRange.values[0];
  assert.equal(updatedRow[0], 117);
  assert.equal(updatedRow[1], 8);
  assert.equal(updatedRow[2], 46260);
  assert.equal(updatedRow[3], ((11 * 60 * 60) + (21 * 60) + 22) / (24 * 60 * 60));
  assert.equal(updatedRow[5], '66857226387700');
  assert.equal(updatedRow[10], 46259);
  assert.equal(updatedRow[11], ((9 * 60 * 60) + (47 * 60) + 52) / (24 * 60 * 60));
  assert.equal(updatedRow[12], '66857221393746');
  assert.equal(row[0], '117');
  assert.equal(row[2], '2026-08-26');
  assert.equal(row[5], 66857226387700);

  const serializedRow = Array(23).fill('');
  serializedRow[2] = '46262';
  serializedRow[3] = '0.3774768519';
  serializedRow[10] = '46262';
  serializedRow[11] = '0.3774768519';
  const [serializedRange] = buildDailyRowUpdateData('2026-08-28', 29, serializedRow);
  const serializedValues = serializedRange.values[0];
  assert.equal(serializedValues[2], 46262);
  assert.equal(serializedValues[3], 0.3774768519);
  assert.equal(serializedValues[10], 46262);
  assert.equal(serializedValues[11], 0.3774768519);

  const invalidRow = Array(23).fill('');
  invalidRow[0] = '_TEMP_scan-id';
  invalidRow[2] = '2026-02-30';
  invalidRow[3] = '24:00:00';
  invalidRow[5] = '001234';
  invalidRow[10] = 'not-a-date';
  invalidRow[11] = '9:99:00';
  invalidRow[12] = Number.MAX_SAFE_INTEGER + 1;
  const [invalidRange] = buildDailyRowUpdateData('2026-08-26', 118, invalidRow);
  assert.deepEqual(
    [0, 2, 3, 5, 10, 11, 12].map((index) => invalidRange.values[0][index]),
    ['_TEMP_scan-id', '2026-02-30', '24:00:00', '001234', 'not-a-date', '9:99:00', Number.MAX_SAFE_INTEGER + 1],
  );
});

test('daily data type formatting targets only date, time and tracking columns', () => {
  const requests = buildDailyDataTypeFormattingRequests(123);
  assert.equal(requests.length, 6);
  assert.deepEqual(
    requests.map(({ repeatCell }) => ({
      startRowIndex: repeatCell.range.startRowIndex,
      startColumnIndex: repeatCell.range.startColumnIndex,
      endColumnIndex: repeatCell.range.endColumnIndex,
      numberFormat: repeatCell.cell.userEnteredFormat.numberFormat,
      fields: repeatCell.fields,
    })),
    [
      { startRowIndex: 1, startColumnIndex: 2, endColumnIndex: 3, numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }, fields: 'userEnteredFormat.numberFormat' },
      { startRowIndex: 1, startColumnIndex: 3, endColumnIndex: 4, numberFormat: { type: 'TIME', pattern: 'h:mm:ss' }, fields: 'userEnteredFormat.numberFormat' },
      { startRowIndex: 1, startColumnIndex: 5, endColumnIndex: 6, numberFormat: { type: 'TEXT', pattern: '@' }, fields: 'userEnteredFormat.numberFormat' },
      { startRowIndex: 1, startColumnIndex: 10, endColumnIndex: 11, numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' }, fields: 'userEnteredFormat.numberFormat' },
      { startRowIndex: 1, startColumnIndex: 11, endColumnIndex: 12, numberFormat: { type: 'TIME', pattern: 'h:mm:ss' }, fields: 'userEnteredFormat.numberFormat' },
      { startRowIndex: 1, startColumnIndex: 12, endColumnIndex: 13, numberFormat: { type: 'TEXT', pattern: '@' }, fields: 'userEnteredFormat.numberFormat' },
    ],
  );
});

test('touched scan rows restore date and time formats without rewriting other columns', () => {
  const requests = buildDailyRowDataTypeFormattingRequests(123, [187, 168, 187, 179]);

  assert.deepEqual(
    requests.map(({ repeatCell }) => ({
      range: repeatCell.range,
      numberFormat: repeatCell.cell.userEnteredFormat.numberFormat,
      fields: repeatCell.fields,
    })),
    [
      {
        range: { sheetId: 123, startRowIndex: 167, endRowIndex: 187, startColumnIndex: 2, endColumnIndex: 3 },
        numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
        fields: 'userEnteredFormat.numberFormat',
      },
      {
        range: { sheetId: 123, startRowIndex: 167, endRowIndex: 187, startColumnIndex: 3, endColumnIndex: 4 },
        numberFormat: { type: 'TIME', pattern: 'h:mm:ss' },
        fields: 'userEnteredFormat.numberFormat',
      },
      {
        range: { sheetId: 123, startRowIndex: 167, endRowIndex: 187, startColumnIndex: 5, endColumnIndex: 6 },
        numberFormat: { type: 'TEXT', pattern: '@' },
        fields: 'userEnteredFormat.numberFormat',
      },
      {
        range: { sheetId: 123, startRowIndex: 167, endRowIndex: 187, startColumnIndex: 10, endColumnIndex: 11 },
        numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' },
        fields: 'userEnteredFormat.numberFormat',
      },
      {
        range: { sheetId: 123, startRowIndex: 167, endRowIndex: 187, startColumnIndex: 11, endColumnIndex: 12 },
        numberFormat: { type: 'TIME', pattern: 'h:mm:ss' },
        fields: 'userEnteredFormat.numberFormat',
      },
      {
        range: { sheetId: 123, startRowIndex: 167, endRowIndex: 187, startColumnIndex: 12, endColumnIndex: 13 },
        numberFormat: { type: 'TEXT', pattern: '@' },
        fields: 'userEnteredFormat.numberFormat',
      },
    ],
  );
  assert.deepEqual(buildDailyRowDataTypeFormattingRequests(123, [1, '2']), []);
});

test('apiFetch aborts a Google request that never responds', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }, { once: true });
  });
  try {
    // Assert the stable code, not the message: the message is user-facing Thai and is
    // expected to change without the timeout behaviour changing.
    await assert.rejects(
      apiFetch('https://example.test', 'token', { timeoutMs: 10 }),
      (error) => error.code === 'GOOGLE_TIMEOUT' && error.timeoutMs === 10,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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

test('conditional formatting reconciliation removes managed copies but preserves custom rules', () => {
  const sheetId = 123;
  const managedRequests = buildMarketplaceFormattingRequests(sheetId);
  const shopeeRule = managedRequests[0].addConditionalFormatRule.rule;
  const googleNormalizedCopy = {
    ...structuredClone(shopeeRule),
    ranges: [{ ...shopeeRule.ranges[0], endRowIndex: 1000 }],
  };
  const customRule = {
    ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 13, endColumnIndex: 14 }],
    booleanRule: {
      condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$N2="manual"' }] },
      format: { backgroundColor: { red: 1 } },
    },
  };

  const requests = buildConditionalFormatReconciliationRequests({
    sheetId,
    existingRules: [shopeeRule, googleNormalizedCopy, customRule],
    managedRequests,
  });

  assert.deepEqual(
    requests.slice(0, 2),
    [
      { deleteConditionalFormatRule: { sheetId, index: 1 } },
      { deleteConditionalFormatRule: { sheetId, index: 0 } },
    ],
  );
  assert.deepEqual(requests.slice(2), managedRequests);
  assert.equal(
    requests.some((request) => request.deleteConditionalFormatRule?.index === 2),
    false,
  );
});

test('Status has strict validation so a scanner cannot enter a tracking number into the column', () => {
  const request = buildStatusValidationRequest(123);
  assert.equal(request.setDataValidation.range.sheetId, 123);
  assert.equal(request.setDataValidation.range.startColumnIndex, 8);
  assert.equal(request.setDataValidation.rule.strict, true);
  assert.deepEqual(
    request.setDataValidation.rule.condition.values.map((value) => value.userEnteredValue),
    ['Success', 'Cancelled', 'Returned', 'Damaged', 'Issue', 'Duplicate', 'รอแพ็ค'],
  );
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

test('appendScanGoogle returns the newly written Packer row after placeholder replacement', async () => {
  const originalFetch = globalThis.fetch;
  const date = '2026-08-05';
  const spreadsheetId = 'sheet-test';
  const sheetProperties = {
    sheets: [{
      properties: {
        sheetId: 123,
        title: date,
        gridProperties: { rowCount: 1000, columnCount: 23 },
      },
    }],
  };
  let storedRows = [];

  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;

    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A1:W1') && method === 'PUT') {
      return jsonResponse({});
    }
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A:A') && method === 'GET') {
      return jsonResponse({ values: [['No.']] });
    }
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2:W') && method === 'GET') {
      return jsonResponse({ values: storedRows });
    }
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2') && !decodedUrl.includes('!A2:W') && method === 'GET') {
      return jsonResponse({ values: [[storedRows[0]?.[0] ?? '']] });
    }
    if (decodedUrl.includes('/values/') && method === 'PUT') {
      storedRows = body?.values ?? storedRows;
      return jsonResponse({});
    }
    if (decodedUrl.includes('/values:batchUpdate')) {
      const rowUpdate = body?.data?.find((item) => item.range.includes('!A2:O2'));
      if (rowUpdate) storedRows = [rowUpdate.values[0]];
      return jsonResponse({});
    }
    if (decodedUrl.includes(':batchUpdate')) {
      return jsonResponse({});
    }
    if (decodedUrl.includes('/values/') && method === 'POST') {
      return jsonResponse({});
    }
    if (decodedUrl.includes('/spreadsheets/')) {
      return jsonResponse(sheetProperties);
    }
    throw new Error(`Unexpected mock request: ${method} ${decodedUrl}`);
  };

  try {
    const result = await appendScanGoogle({
      token: 'token',
      config: { master: { id: spreadsheetId, webViewLink: 'https://example.test/sheet' } },
      courier: 'Shopee',
      code: 'TH1234567890',
      email: 'packer@example.com',
      packer: 'เบ้น',
      scanDate: date,
      scanTime: '10:20:30',
    });

    assert.equal(result.status, 'success');
    assert.equal(result.count, 1);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].courier, 'Shopee');
    assert.equal(result.rows[0].code, 'TH1234567890');
    assert.equal(result.row.code, 'TH1234567890');
    assert.equal(result.row.status, 'Success');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('appendScanGoogle does not mark a row as cross-day when its saved Scan Date equals Admin Scan Date', async () => {
  const originalFetch = globalThis.fetch;
  const today = '2026-08-25';
  const yesterday = '2026-08-24';
  const spreadsheetId = 'sheet-cross-day-remark-test';
  const code = 'TH2695488345554';
  const sheetProperties = {
    sheets: [
      { properties: { sheetId: 124, title: yesterday, gridProperties: { rowCount: 1000, columnCount: 23 } } },
      { properties: { sheetId: 125, title: today, gridProperties: { rowCount: 1000, columnCount: 23 } } },
    ],
  };
  const rowsByDate = new Map([
    [yesterday, [[
      '1', '1', yesterday, '09:00:00', 'Shopee', '', '', '', 'รอแพ็ค', '',
      yesterday, '09:00:00', code,
    ]]],
    [today, []],
  ]);

  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const date = [today, yesterday].find((value) => decodedUrl.includes(value));

    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A1:W1') && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A:A') && method === 'GET') return jsonResponse({ values: [['No.']] });
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2:W') && method === 'GET') return jsonResponse({ values: rowsByDate.get(date) ?? [] });
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2') && method === 'GET') return jsonResponse({ values: [rowsByDate.get(date)?.[0] ?? []] });
    if (decodedUrl.includes('/values:batchUpdate')) {
      const rowUpdate = body?.data?.find((item) => item.range.includes('!A2:O2'));
      const updateDate = date ?? [today, yesterday].find((value) => rowUpdate?.range?.includes(value));
      if (rowUpdate && updateDate) rowsByDate.set(updateDate, [rowUpdate.values[0]]);
      return jsonResponse({});
    }
    if (decodedUrl.includes(':batchUpdate')) return jsonResponse({});
    if (decodedUrl.includes('/spreadsheets/')) return jsonResponse(sheetProperties);
    throw new Error(`Unexpected mock request: ${method} ${decodedUrl}`);
  };

  try {
    const result = await appendScanGoogle({
      token: 'token',
      config: { master: { id: spreadsheetId, webViewLink: 'https://example.test/sheet' } },
      courier: 'Shopee',
      code,
      email: 'packer@example.com',
      packer: 'เบ้น',
      scanDate: today,
      scanTime: '10:20:30',
    });

    assert.equal(result.status, 'success');
    assert.equal(result.crossDay, true);
    assert.equal(rowsByDate.get(today).length, 0);
    assert.equal(rowsByDate.get(yesterday)[0][2], 46258);
    assert.equal(rowsByDate.get(yesterday)[0][10], 46258);
    assert.equal(rowsByDate.get(yesterday)[0][9], '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('appendScanGoogle marks a successful row as cross-day when its saved Scan Date is after Admin Scan Date', async () => {
  const originalFetch = globalThis.fetch;
  const today = '2026-08-25';
  const yesterday = '2026-08-24';
  const spreadsheetId = 'sheet-valid-cross-day-remark-test';
  const code = 'JTTH203025858346';
  const sheetProperties = {
    sheets: [{ properties: { sheetId: 126, title: today, gridProperties: { rowCount: 1000, columnCount: 23 } } }],
  };
  let storedRows = [[
    '1', '1', today, '09:00:00', 'Shopee', '', '', '', 'รอแพ็ค', '',
    yesterday, '09:00:00', code,
  ]];

  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;

    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A1:W1') && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2:W') && method === 'GET') return jsonResponse({ values: storedRows });
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2') && method === 'GET') return jsonResponse({ values: [storedRows[0] ?? []] });
    if (decodedUrl.includes('/values:batchUpdate')) {
      const rowUpdate = body?.data?.find((item) => item.range.includes('!A2:O2'));
      if (rowUpdate) storedRows = [rowUpdate.values[0]];
      return jsonResponse({});
    }
    if (decodedUrl.includes(':batchUpdate')) return jsonResponse({});
    if (decodedUrl.includes('/spreadsheets/')) return jsonResponse(sheetProperties);
    throw new Error(`Unexpected mock request: ${method} ${decodedUrl}`);
  };

  try {
    const result = await appendScanGoogle({
      token: 'token',
      config: { master: { id: spreadsheetId, webViewLink: 'https://example.test/sheet' } },
      courier: 'Shopee',
      code,
      email: 'packer@example.com',
      packer: 'เบ้น',
      scanDate: today,
      scanTime: '10:20:30',
    });

    assert.equal(result.status, 'success');
    assert.equal(storedRows[0][2], 46259);
    assert.equal(storedRows[0][10], 46258);
    assert.equal(storedRows[0][9], `แพ็คข้ามวัน (สแกน ${today})`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('batch recovery repairs an existing row whose Status does not match Firestore', async () => {
  const originalFetch = globalThis.fetch;
  const date = '2026-08-06';
  const spreadsheetId = 'sheet-recovery-test';
  const sheetProperties = {
    sheets: [{ properties: { sheetId: 456, title: date, gridProperties: { rowCount: 1000, columnCount: 23 } } }],
  };
  let storedRows = [[
    '1', '1', date, '10:00:00', 'Shopee', 'TH1234567890', 'packer@example.com', 'เบ้น', 'TH999', '',
    date, '09:00:00', 'TH1234567890',
  ]];
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A1:W1') && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2:W') && method === 'GET') return jsonResponse({ values: storedRows });
    if (decodedUrl.includes('/values:batchUpdate')) {
      const rowUpdate = body?.data?.find((item) => item.range.includes('!A2:O2'));
      if (rowUpdate) storedRows = [rowUpdate.values[0]];
      return jsonResponse({});
    }
    if (decodedUrl.includes(':batchUpdate')) return jsonResponse({});
    if (decodedUrl.includes('/spreadsheets/')) return jsonResponse(sheetProperties);
    throw new Error(`Unexpected mock request: ${method} ${decodedUrl}`);
  };

  try {
    const [outcome] = await batchAppendScanGoogle({
      token: 'token',
      config: { master: { id: spreadsheetId, webViewLink: 'https://example.test/sheet' } },
      repairExisting: true,
      orders: [{
        code: 'TH1234567890',
        courier: 'Shopee',
        date,
        time: '10:00:00',
        email: 'packer@example.com',
        packer: 'เบ้น',
        isPacker: true,
        adminDate: date,
        adminTime: '09:00:00',
        adminCode: 'TH1234567890',
      }],
    });

    assert.equal(outcome.result.repaired, true);
    assert.equal(outcome.result.status, 'success');
    assert.equal(outcome.result.row.status, 'Success');
    assert.equal(storedRows[0][8], 'Success');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('batch recovery removes a stale cross-day Remark even when the Status is already correct', async () => {
  const originalFetch = globalThis.fetch;
  const date = '2026-08-24';
  const spreadsheetId = 'sheet-cross-day-recovery-test';
  const sheetProperties = {
    sheets: [{ properties: { sheetId: 457, title: date, gridProperties: { rowCount: 1000, columnCount: 23 } } }],
  };
  let storedRows = [[
    '1', '1', date, '10:00:00', 'Shopee', 'TH2695488345554', 'packer@example.com', 'เบ้น', 'Success',
    'แพ็คข้ามวัน (สแกน 2026-08-25)', date, '09:00:00', 'TH2695488345554',
  ]];
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A1:W1') && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2:W') && method === 'GET') return jsonResponse({ values: storedRows });
    if (decodedUrl.includes('/values:batchUpdate')) {
      const rowUpdate = body?.data?.find((item) => item.range.includes('!A2:O2'));
      if (rowUpdate) storedRows = [rowUpdate.values[0]];
      return jsonResponse({});
    }
    if (decodedUrl.includes(':batchUpdate')) return jsonResponse({});
    if (decodedUrl.includes('/spreadsheets/')) return jsonResponse(sheetProperties);
    throw new Error(`Unexpected mock request: ${method} ${decodedUrl}`);
  };

  try {
    const [outcome] = await batchAppendScanGoogle({
      token: 'token',
      config: { master: { id: spreadsheetId, webViewLink: 'https://example.test/sheet' } },
      repairExisting: true,
      orders: [{
        code: 'TH2695488345554',
        courier: 'Shopee',
        date,
        time: '10:00:00',
        email: 'packer@example.com',
        packer: 'เบ้น',
        isPacker: true,
        adminDate: date,
        adminTime: '09:00:00',
        adminCode: 'TH2695488345554',
      }],
    });

    assert.equal(outcome.result.repaired, true);
    assert.equal(outcome.result.row.note, '');
    assert.equal(storedRows[0][9], '');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
