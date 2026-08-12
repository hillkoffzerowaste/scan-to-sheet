import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMarketplaceFormattingRequests,
  appendScanGoogle,
  findCancellationRow,
  getDailySheetPropertiesForMarketplaceBackfill,
  apiFetch,
} from './googleSheets.js';

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
    if (decodedUrl.includes('/values:batchUpdate') || decodedUrl.includes(':batchUpdate')) {
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
