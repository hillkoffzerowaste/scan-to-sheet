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
  doesBangkokDateOverlapLookback,
  findCancellationRow,
  findMarketplaceOrderGoogle,
  listMarketplaceOrdersGoogle,
  getDailySheetPropertiesForMarketplaceBackfill,
  upsertMarketplaceOrdersGoogle,
  updateScanIssueGoogle,
  apiFetch,
  isInstantWithinLookback,
  syncLateOrdersGoogle,
} from './googleSheets.js';
import { isSheetSyncResultConfirmed } from './sheetSyncReconciliation.js';

// Only the HTTP boundary is replaced: keep reconciliation, RAW conversion and readback real.
function recoverySheet(t, initialRows, hooks = {}) {
  const originalFetch = globalThis.fetch;
  const rowsByDate = new Map(Object.entries(structuredClone(initialRows)));
  const titles = [...rowsByDate.keys()];
  const writes = [];
  const gridRequests = [];
  const reads = new Map();
  const json = (payload) => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  const columnIndex = (letters) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
  const parseRange = (range) => {
    const match = range.match(/^'([^']+)'!([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/);
    assert.ok(match, range);
    return { date: match[1], col: columnIndex(match[2]), start: Number(match[3]) || 1,
      endCol: columnIndex(match[4] || match[2]), end: Number(match[5]) || (match[4] ? Infinity : Number(match[3])) };
  };
  const formatted = (value, column) => {
    if (typeof value !== 'number') return value;
    if ([2, 10].includes(column)) return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
    if ([3, 11].includes(column)) return new Date(Math.round(value * 86400) * 1000).toISOString().slice(11, 19);
    return String(value);
  };
  const write = (range, values) => {
    const { date, col, start } = parseRange(range);
    if (start === 1) return;
    const rows = rowsByDate.get(date);
    values.forEach((cells, offset) => {
      const index = start - 2 + offset;
      while (rows.length <= index) rows.push([]);
      cells.forEach((value, cell) => { if (value !== null) rows[index][col + cell] = value; });
    });
  };
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    const path = decodeURIComponent(parsed.pathname);
    const method = options.method || 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (parsed.searchParams.get('includeGridData') === 'true') {
      const ranges = parsed.searchParams.getAll('ranges');
      gridRequests.push({ ranges, length: String(url).length });
      hooks.beforeGrid?.({ rowsByDate, ranges });
      return json({ sheets: [{ data: ranges.map((range) => {
        const { date, start, col, endCol } = parseRange(range);
        const row = rowsByDate.get(date)?.[start - 2] || [];
        const values = Array.from({ length: endCol - col + 1 }, (_, index) => {
          const value = row[col + index];
          return value === undefined || value === '' ? {} : {
            userEnteredValue: { [typeof value === 'number' ? 'numberValue' : 'stringValue']: value },
          };
        });
        return { startRow: start - 1, startColumn: col, rowData: [{ values }] };
      }) }] });
    }
    if (path.includes('/values/')) {
      const range = path.split('/values/')[1];
      const { date, col, start, end, endCol } = parseRange(range);
      if (method === 'PUT') {
        if (start === 1) return json({});
        writes.push({ range, values: body.values });
        hooks.beforeAppend?.({ rowsByDate });
        write(range, body.values);
        hooks.afterAppend?.({ rowsByDate });
        return json({});
      }
      const count = (reads.get(date) || 0) + 1;
      reads.set(date, count);
      hooks.beforeRead?.({ rowsByDate, date, count, range });
      const rows = rowsByDate.get(date) || [];
      if (range.endsWith('!A:A')) {
        const values = ['No.', ...rows.map((row) => row[0] ?? '')];
        while (values.at(-1) === '') values.pop();
        return json({ values: [values] });
      }
      const values = rows.slice(start - 2, Number.isFinite(end) ? end - 1 : undefined)
        .map((row) => Array.from({ length: endCol - col + 1 }, (_, i) => formatted(row[col + i] ?? '', col + i)));
      return json({ values });
    }
    if (path.endsWith('/values:batchUpdate')) {
      assert.equal(body.valueInputOption, 'RAW');
      writes.push(...body.data);
      if (!hooks.dropUpdates) body.data.forEach(({ range, values }) => write(range, values));
      hooks.afterUpdate?.({ rowsByDate, data: body.data });
      return json({});
    }
    if (path.endsWith(':batchUpdate')) {
      for (const request of body.requests || []) {
        if (!request.appendCells) continue;
        hooks.beforeAppend?.({ rowsByDate });
        const { sheetId, rows, fields } = request.appendCells;
        assert.equal(fields, 'userEnteredValue');
        const stored = rowsByDate.get(titles[sheetId - 100]);
        rows.forEach(({ values }) => stored.push(values.map(({ userEnteredValue: value }) => value?.numberValue ?? value?.stringValue ?? '')));
        hooks.afterAppend?.({ rowsByDate });
      }
      return json({});
    }
    if (method === 'GET' && path.includes('/spreadsheets/')) {
      return json({ sheets: titles.map((title, i) => ({ properties: {
        sheetId: 100 + i, title, gridProperties: { rowCount: 1000, columnCount: 23 },
      } })) });
    }
    throw new Error(`Unexpected Sheets request: ${method} ${path}`);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return { rowsByDate, writes, gridRequests, run: (orders, repairExisting = true) => batchAppendScanGoogle({
    token: 'test-token', config: { master: { id: `recovery-${t.name}`, webViewLink: 'https://example.test/sheet' } },
    orders, repairExisting,
  }) };
}

const recoveryDate = '2026-08-25';
const recoveryCode = '001234567890123456';
const recoveryOrder = (fields = {}) => ({
  code: recoveryCode, courier: 'Shopee', date: recoveryDate, time: '12:00:00',
  email: 'packer@example.test', packer: 'Ben', isPacker: true, ...fields,
});
const recoveryRow = (cells = {}) => Object.assign([
  1, 1, 46259, 0.5, 'Shopee', recoveryCode, 'packer@example.test', 'Ben', 'Success', '',
  '', '', '', '', '', 'Manual buyer', '', '', '', '', 'ส่งออกแล้ว', 'ไม่ใช่', 'verified',
], cells);

test('batch native verification accepts Packer-only rows with empty Admin dates and midnight', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow({ 3: 0 })] });
  const [item] = await sheet.run([recoveryOrder({ time: '00:00:00' })], false);
  assert.equal(item.error, undefined);
  assert.equal(item.result.nativeDataTypesVerified, true);
  assert.equal(item.result.isPacker, true);
});

test('batch recovery fills missing Admin fields from the order and preserves buyer P', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow()] });
  const [item] = await sheet.run([recoveryOrder({ adminCode: recoveryCode, adminDate: recoveryDate, adminTime: '09:00:00' })]);
  assert.equal(item.error, undefined);
  assert.equal(item.result.row.adminCode, recoveryCode);
  assert.equal(item.result.row.adminTime, '09:00:00');
  assert.equal(item.result.nativeDataTypesVerified, true);
  assert.deepEqual(sheet.rowsByDate.get(recoveryDate)[0].slice(10, 13), [46259, 0.375, recoveryCode]);
  assert.equal(sheet.rowsByDate.get(recoveryDate)[0][15], 'Manual buyer');
});

test('batch Admin retry preserves packed status and original Admin time', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow({ 10: 46259, 11: 0.375, 12: recoveryCode })] });
  const [item] = await sheet.run([recoveryOrder({ isPacker: false, adminCode: recoveryCode, adminDate: recoveryDate, adminTime: '11:00:00' })]);
  assert.equal(item.error, undefined);
  assert.equal(item.result.row.status, 'Success');
  assert.equal(item.result.row.adminTime, '09:00:00');
  assert.equal(item.result.isPacker, false);
  assert.equal(item.result.nativeDataTypesVerified, true);
});

test('batch recovery converts legacy duplicate timestamps to RAW numbers without changing tracking', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow({ 0: '1', 1: '1', 2: recoveryDate, 3: '12:00:00' })] });
  const [item] = await sheet.run([recoveryOrder()]);
  assert.equal(item.error, undefined);
  assert.equal(item.result.nativeDataTypesVerified, true);
  assert.deepEqual(sheet.rowsByDate.get(recoveryDate)[0].slice(0, 6), [1, 1, 46259, 0.5, 'Shopee', recoveryCode]);
  assert.equal(item.result.row.buyerName, 'Manual buyer');
});

test('batch native verification splits large recovery reads into bounded requests', async (t) => {
  const orders = Array.from({ length: 125 }, (_, i) => recoveryOrder({ code: `TH${String(i).padStart(12, '0')}` }));
  const sheet = recoverySheet(t, { [recoveryDate]: orders.map((order, i) => recoveryRow({ 0: i + 1, 1: i + 1, 5: order.code, 10: 46259, 11: 0.375, 12: order.code })) });
  const items = await sheet.run(orders, false);
  assert.equal(items.length, 125);
  assert.ok(items.every((item) => item.result?.nativeDataTypesVerified === true));
  assert.ok(sheet.gridRequests.length >= 3);
  assert.ok(sheet.gridRequests.every(({ ranges, length }) => ranges.length <= 50 && length <= 8000));
});

test('batch missing placeholder fails only its order while duplicates still get native verification', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow({ 10: 46259, 11: 0.375, 12: recoveryCode })] }, {
    afterAppend: ({ rowsByDate }) => { rowsByDate.set(recoveryDate, rowsByDate.get(recoveryDate).filter((row) => !String(row[0]).startsWith('_TEMP_'))); },
  });
  const items = await sheet.run([recoveryOrder(), recoveryOrder({ code: 'TH999999999999' })], false);
  assert.equal(items.find((item) => item.order.code === recoveryCode).result?.nativeDataTypesVerified, true);
  const missing = items.find((item) => item.order.code === 'TH999999999999');
  assert.equal(missing.result, null);
  assert.ok(missing.error);
});

test('batch cross-day merge verifies the physical tab and explicitly returns its role', async (t) => {
  const yesterday = '2026-08-24';
  const sheet = recoverySheet(t, { [recoveryDate]: [], [yesterday]: [recoveryRow({ 2: 46258, 5: '', 7: '', 8: 'รอแพ็ค', 10: 46258, 11: 0.375, 12: recoveryCode })] });
  const [item] = await sheet.run([recoveryOrder()]);
  assert.equal(item.error, undefined);
  assert.equal(item.result.row._sheetDate, yesterday);
  assert.equal(item.result.nativeDataTypesVerified, true);
  assert.equal(item.result.isPacker, true);
  assert.equal(item.result.row.code, recoveryCode);
});

test('batch append preserves trailing occupied rows even when column A is empty', async (t) => {
  const manual = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Keep this buyer'];
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow(), manual] });
  const [item] = await sheet.run([recoveryOrder({ code: 'TH999999999999' })]);
  assert.equal(item.error, undefined);
  assert.deepEqual(sheet.rowsByDate.get(recoveryDate)[1], manual);
  assert.equal(item.result.row.sheetRowNumber, 4);
  assert.equal(item.result.nativeDataTypesVerified, true);
  assert.equal(item.result.isPacker, true);
});

test('batch append cannot overwrite another row arriving after its initial read', async (t) => {
  let inserted = false;
  const other = recoveryRow({ 0: 2, 1: 2, 5: 'TH888888888888' });
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow()] }, {
    beforeAppend: ({ rowsByDate }) => {
      if (inserted) return;
      inserted = true;
      rowsByDate.get(recoveryDate).push(structuredClone(other));
    },
  });
  const [item] = await sheet.run([recoveryOrder({ code: 'TH999999999999' })]);
  assert.equal(item.error, undefined);
  assert.deepEqual(sheet.rowsByDate.get(recoveryDate)[1], other);
  assert.equal(item.result.row.sheetRowNumber, 4);
});

test('batch duplicate readback cannot retain a row removed since reconciliation', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow({ 10: 46259, 11: 0.375, 12: recoveryCode })] }, {
    beforeRead: ({ rowsByDate, count }) => { if (count >= 3) rowsByDate.set(recoveryDate, []); },
  });
  const [item] = await sheet.run([recoveryOrder()], false);
  assert.equal(item.result?.row ?? null, null);
  assert.notEqual(item.result?.nativeDataTypesVerified, true);
});

test('batch repeated order uses final readback instead of its synthesized placeholder', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [] });
  const items = await sheet.run([recoveryOrder(), recoveryOrder()]);
  assert.equal(sheet.rowsByDate.get(recoveryDate).length, 1);
  for (const item of items) {
    assert.equal(item.error, undefined);
    assert.equal(item.result.row.no, '1');
    assert.equal(item.result.row.code, recoveryCode);
    assert.equal(item.result.nativeDataTypesVerified, true);
    assert.equal(item.result.isPacker, true);
  }
});

test('batch leaves failed RAW repairs unverified when Google returns legacy text again', async (t) => {
  const sheet = recoverySheet(t, { [recoveryDate]: [recoveryRow({ 2: recoveryDate, 3: '12:00:00', 8: 'Issue' })] }, { dropUpdates: true });
  const [item] = await sheet.run([recoveryOrder()]);
  assert.notEqual(item.result?.nativeDataTypesVerified, true);
  assert.equal(item.result?.row?.status, 'Issue');
});

test('batch native verification rejects partial Admin pairs and invalid numeric dates', async (t) => {
  const orders = [recoveryOrder(), recoveryOrder({ code: 'TH999999999999' })];
  const sheet = recoverySheet(t, { [recoveryDate]: [
    recoveryRow({ 10: 46259, 11: '', 12: recoveryCode }),
    recoveryRow({ 0: 2, 1: 2, 2: 0, 5: orders[1].code, 10: 46259, 11: 0.375, 12: orders[1].code }),
  ] });
  const items = await sheet.run(orders, false);
  assert.ok(items.every((item) => item.result?.nativeDataTypesVerified === false));
});

test('missing-order lookback includes the Bangkok boundary day but filters exact row times', () => {
  const now = new Date('2026-08-31T15:00:00.000Z'); // 22:00 Bangkok
  const lookbackMs = 48 * 60 * 60 * 1000;

  assert.equal(doesBangkokDateOverlapLookback('2026-08-29', now, lookbackMs), true);
  assert.equal(doesBangkokDateOverlapLookback('2026-08-28', now, lookbackMs), false);
  assert.equal(doesBangkokDateOverlapLookback('2026-09-01', now, lookbackMs), false);

  assert.equal(isInstantWithinLookback(new Date('2026-08-29T16:00:00.000Z'), now, lookbackMs), true);
  assert.equal(isInstantWithinLookback(new Date('2026-08-29T14:59:59.999Z'), now, lookbackMs), false);

  // เวลาในชีตมาจากนาฬิกาของเครื่องที่สแกน แถวที่เพิ่งสแกนจากเครื่องที่เร็วกว่าเล็กน้อยต้องยังนับ
  // อยู่ในหน้าต่าง ไม่งั้นออเดอร์ที่สแกนแล้วจะถูกรายงานว่าตกหล่น
  assert.equal(isInstantWithinLookback(new Date('2026-08-31T15:00:00.001Z'), now, lookbackMs), true);
  assert.equal(isInstantWithinLookback(new Date('2026-08-31T15:05:00.000Z'), now, lookbackMs), true);
  assert.equal(isInstantWithinLookback(new Date('2026-08-31T15:05:00.001Z'), now, lookbackMs), false);
  // แท็บที่ลงวันที่เป็นวันข้างหน้ายังต้องถูกตัดที่ระดับวัน เพราะนั่นคือการพิมพ์ผิด
  assert.equal(doesBangkokDateOverlapLookback('2026-09-02', now, lookbackMs), false);
});

test('Marketplace Orders upsert keeps unchanged rows and appends only new order keys', async () => {
  const originalFetch = globalThis.fetch;
  const spreadsheetId = 'marketplace-orders-upsert-test';
  const existingRows = [[
    'shopee__ORDER-1', 'TH123', 'TH123', 'shopee', 'ORDER-1', '["SKU-1"]',
    '[{"name":"Coffee","quantity":1}]', '1', 'READY', '', '2026-08-30 09:00:00', '2026-08-30T02:00:00.000Z',
  ]];
  const appended = [];
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (decodedUrl.includes(`/spreadsheets/${spreadsheetId}?fields=`)) {
      return jsonResponse({ sheets: [{ properties: { sheetId: 701, title: 'Marketplace Orders', gridProperties: { rowCount: 1000, columnCount: 12 } } }] });
    }
    if (decodedUrl.includes("'Marketplace Orders'!A1:L1") && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes("'Marketplace Orders'!A2:L") && method === 'GET') return jsonResponse({ values: existingRows });
    if (decodedUrl.includes("'Marketplace Orders'!A:L:append") && method === 'POST') {
      appended.push(...body.values);
      return jsonResponse({});
    }
    throw new Error(`Unexpected request: ${method} ${decodedUrl}`);
  };

  try {
    const result = await upsertMarketplaceOrdersGoogle({
      token: 'token', config: { master: { id: spreadsheetId } }, groups: [
        {
          platform: 'shopee', orderId: 'ORDER-1', trackingNo: 'TH123', normalizedTrackingNo: 'TH123',
          marketplaceSkus: ['SKU-1'], items: [{ name: 'Coffee', quantity: 1 }], sourceRowCount: 1,
          sellerOrderStatus: 'READY', expectedShipAt: '', orderedAt: '2026-08-30 09:00:00',
        },
        {
          platform: 'lazada', orderId: 'ORDER-2', trackingNo: 'TH456', normalizedTrackingNo: 'TH456',
          marketplaceSkus: ['SKU-2'], items: [{ name: 'Tea', quantity: 2 }], sourceRowCount: 1,
          sellerOrderStatus: 'READY', expectedShipAt: '', orderedAt: '2026-08-30 10:00:00',
        },
      ],
    });

    assert.deepEqual(
      {
        imported: result.imported,
        updated: result.updated,
        unchanged: result.unchanged,
        collisions: result.collisions,
        skipped: result.skipped,
        stored: result.stored,
      },
      { imported: 1, updated: 0, unchanged: 1, collisions: 0, skipped: 0, stored: 2 },
    );
    assert.equal(appended.length, 1);
    assert.equal(appended[0][0], 'lazada__ORDER-2');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Marketplace Orders gives still-new rows priority when the import cap is reached', async () => {
  const originalFetch = globalThis.fetch;
  const spreadsheetId = 'marketplace-orders-new-priority-test';
  const appended = [];
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    if (decodedUrl.includes(`/spreadsheets/${spreadsheetId}?fields=`)) {
      return jsonResponse({ sheets: [{ properties: { sheetId: 703, title: 'Marketplace Orders', gridProperties: { rowCount: 1000, columnCount: 12 } } }] });
    }
    if (decodedUrl.includes("'Marketplace Orders'!A1:L1") && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes("'Marketplace Orders'!A2:L") && method === 'GET') {
      return jsonResponse({ values: [[
        'shopee__EXISTING', 'TH100', 'TH100', 'shopee', 'EXISTING', '[]', '[]', '1', '', '', '2026-08-30 12:00:00', '',
      ]] });
    }
    if (decodedUrl.includes("'Marketplace Orders'!A:L:append") && method === 'POST') {
      appended.push(...body.values);
      return jsonResponse({});
    }
    throw new Error(`Unexpected request: ${method} ${decodedUrl}`);
  };
  try {
    const result = await upsertMarketplaceOrdersGoogle({
      token: 'token', config: { master: { id: spreadsheetId } }, max: 1, groups: [
        { platform: 'shopee', orderId: 'EXISTING', trackingNo: 'TH100', normalizedTrackingNo: 'TH100', orderedAt: '2026-08-30 12:00:00' },
        { platform: 'shopee', orderId: 'NEW-OLDER', trackingNo: 'TH101', normalizedTrackingNo: 'TH101', orderedAt: '2026-08-29 08:00:00' },
      ],
    });
    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 1);
    assert.equal(result.groups[0].orderId, 'NEW-OLDER');
    assert.equal(appended[0][0], 'shopee__NEW-OLDER');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Marketplace Orders lookup returns one exact normalized tracking match', async () => {
  const originalFetch = globalThis.fetch;
  const spreadsheetId = 'marketplace-orders-lookup-test';
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    if (decodedUrl.includes(`/spreadsheets/${spreadsheetId}?fields=`)) {
      return jsonResponse({ sheets: [{ properties: { sheetId: 702, title: 'Marketplace Orders', gridProperties: { rowCount: 1000, columnCount: 12 } } }] });
    }
    if (decodedUrl.includes("'Marketplace Orders'!A1:L1") && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes("'Marketplace Orders'!A2:L") && method === 'GET') {
      return jsonResponse({ values: [[
        'tiktok__ORDER-3', 'THT-123', 'THT-123', 'tiktok', 'ORDER-3', '["SKU-3"]',
        '[{"name":"Drip","quantity":1}]', '1', 'READY', '', '', '2026-08-30T02:00:00.000Z',
      ]] });
    }
    throw new Error(`Unexpected request: ${method} ${decodedUrl}`);
  };
  try {
    const order = await findMarketplaceOrderGoogle({
      token: 'token', config: { master: { id: spreadsheetId } }, trackingNo: 'THT123',
    });
    assert.equal(order.orderId, 'ORDER-3');
    assert.deepEqual(order.marketplaceSkus, ['SKU-3']);
    assert.equal(order.status, 'READY');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Marketplace Orders list is capped and shows newest orders first', async () => {
  const originalFetch = globalThis.fetch;
  const spreadsheetId = 'marketplace-orders-list-test';
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    if (decodedUrl.includes(`/spreadsheets/${spreadsheetId}?fields=`)) {
      return jsonResponse({ sheets: [{ properties: { sheetId: 705, title: 'Marketplace Orders', gridProperties: { rowCount: 1000, columnCount: 12 } } }] });
    }
    if (decodedUrl.includes("'Marketplace Orders'!A2:L") && method === 'GET') {
      return jsonResponse({ values: [
        ['shopee__OLD', 'THOLD1234', 'THOLD1234', 'shopee', 'OLD', '[]', '[]', '1', 'READY', '', '2026-08-20 08:00:00', ''],
        ['shopee__NEW', 'THNEW1234', 'THNEW1234', 'shopee', 'NEW', '[]', '[]', '1', 'READY', '', '2026-08-22 08:00:00', ''],
      ] });
    }
    throw new Error(`Unexpected request: ${method} ${decodedUrl}`);
  };
  try {
    const orders = await listMarketplaceOrdersGoogle({
      token: 'token', config: { master: { id: spreadsheetId } }, limit: 1,
    });
    assert.equal(orders.length, 1);
    assert.equal(orders[0].orderId, 'NEW');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Marketplace Orders shares one cold-cache request across concurrent scan lookups', async () => {
  const originalFetch = globalThis.fetch;
  const spreadsheetId = 'marketplace-orders-concurrent-lookup-test';
  let spreadsheetReads = 0;
  let catalogReads = 0;
  let headerWrites = 0;
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    if (decodedUrl.includes(`/spreadsheets/${spreadsheetId}?fields=`)) {
      spreadsheetReads += 1;
      return jsonResponse({ sheets: [{ properties: { sheetId: 704, title: 'Marketplace Orders', gridProperties: { rowCount: 1000, columnCount: 12 } } }] });
    }
    if (decodedUrl.includes("'Marketplace Orders'!A1:L1") && method === 'PUT') {
      headerWrites += 1;
      return jsonResponse({});
    }
    if (decodedUrl.includes("'Marketplace Orders'!A2:L") && method === 'GET') {
      catalogReads += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({ values: [[
        'shopee__ORDER-4', 'TH456', 'TH456', 'shopee', 'ORDER-4', '[]', '[]', '1', 'READY', '', '', '',
      ]] });
    }
    throw new Error(`Unexpected request: ${method} ${decodedUrl}`);
  };
  try {
    const lookups = await Promise.all(Array.from({ length: 20 }, () => findMarketplaceOrderGoogle({
      token: 'token', config: { master: { id: spreadsheetId } }, trackingNo: 'TH456',
    })));
    assert.equal(lookups.length, 20);
    assert.ok(lookups.every((order) => order?.orderId === 'ORDER-4'));
    assert.equal(spreadsheetReads, 1);
    assert.equal(catalogReads, 1);
    assert.equal(headerWrites, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

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

test('appendScanGoogle preserves today as Scan Date when it merges into yesterday’s Admin row', async () => {
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
    assert.equal(rowsByDate.get(yesterday)[0][2], 46259);
    assert.equal(rowsByDate.get(yesterday)[0][10], 46258);
    assert.equal(rowsByDate.get(yesterday)[0][9], `แพ็คข้ามวัน (สแกน ${today})`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('updateScanIssueGoogle finds a cross-day row on its physical prior tab', async () => {
  const originalFetch = globalThis.fetch;
  const today = '2026-08-25';
  const yesterday = '2026-08-24';
  const spreadsheetId = 'sheet-cross-day-issue-test';
  const code = 'TH264000000000A';
  const sheetProperties = {
    sheets: [
      { properties: { sheetId: 127, title: yesterday, gridProperties: { rowCount: 1000, columnCount: 23 } } },
      { properties: { sheetId: 128, title: today, gridProperties: { rowCount: 1000, columnCount: 23 } } },
    ],
  };
  const rowsByDate = new Map([
    [yesterday, [[
      '1', '1', today, '10:20:30', 'Shopee', code, 'packer@example.com', 'เบ้น', 'Success',
      `แพ็คข้ามวัน (สแกน ${today})`, yesterday, '09:00:00', code,
    ]]],
    [today, []],
  ]);
  let updateRange = '';

  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    const date = [today, yesterday].find((value) => decodedUrl.includes(value));

    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2:W') && method === 'GET') return jsonResponse({ values: rowsByDate.get(date) ?? [] });
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2') && method === 'GET') return jsonResponse({ values: [rowsByDate.get(date)?.[0] ?? []] });
    if (decodedUrl.includes('/values:batchUpdate')) {
      const rowUpdate = body?.data?.find((item) => item.range.includes('!A2:O2'));
      if (rowUpdate) {
        updateRange = rowUpdate.range;
        rowsByDate.set(yesterday, [rowUpdate.values[0]]);
      }
      return jsonResponse({});
    }
    if (decodedUrl.includes(':batchUpdate')) return jsonResponse({});
    if (decodedUrl.includes('/spreadsheets/')) return jsonResponse(sheetProperties);
    throw new Error(`Unexpected mock request: ${method} ${decodedUrl}`);
  };

  try {
    await updateScanIssueGoogle({
      token: 'token',
      config: { master: { id: spreadsheetId, webViewLink: 'https://example.test/sheet' } },
      row: { date: today, courier: 'Shopee', code },
      issue: 'สินค้าเสียหาย',
    });

    assert.match(updateRange, new RegExp(`^'${yesterday}'!A2:O2$`));
    assert.equal(rowsByDate.get(yesterday)[0][2], 46259);
    assert.equal(rowsByDate.get(yesterday)[0][8], 'Damaged');
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

test('batch recovery read-verifies an existing duplicate before certifying it', async () => {
  const originalFetch = globalThis.fetch;
  const date = '2026-08-07';
  const spreadsheetId = 'sheet-duplicate-verification-test';
  const sheetProperties = {
    sheets: [{ properties: { sheetId: 458, title: date, gridProperties: { rowCount: 1000, columnCount: 23 } } }],
  };
  const storedRows = [[
    '1', '1', date, '10:00:00', 'Shopee', 'TH1234567890', 'packer@example.com', 'เบ้น', 'Success', '',
    date, '09:00:00', 'TH1234567890', '', '', '', '', '', '', '', '', '', '',
  ]];
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A1:W1') && method === 'PUT') return jsonResponse({});
    if (decodedUrl.includes('/values/') && decodedUrl.includes('!A2:W') && method === 'GET') return jsonResponse({ values: storedRows });
    if (decodedUrl.includes('includeGridData=true')) {
      const values = Array.from({ length: 10 }, (_, index) => (
        [0, 1, 8, 9].includes(index)
          ? { userEnteredValue: { numberValue: ({ 0: 46241, 1: 10 / 24, 8: 46241, 9: 9 / 24 })[index] } }
          : {}
      ));
      return jsonResponse({ sheets: [{ data: [{ rowData: [{ values }] }] }] });
    }
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

    assert.equal(outcome.result.status, 'duplicate');
    assert.equal(outcome.result.nativeDataTypesVerified, true);
    assert.equal(isSheetSyncResultConfirmed(outcome.result), true);
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

test('Late Orders writes quote the sheet name so Google can parse the range', async () => {
  const originalFetch = globalThis.fetch;
  const spreadsheetId = 'sheet-late-orders-test';
  const requestedRanges = [];
  const jsonResponse = (payload) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });

  globalThis.fetch = async (url, options = {}) => {
    const decodedUrl = decodeURIComponent(String(url));
    const method = options.method ?? 'GET';
    const range = decodedUrl.match(/\/values\/([^:?]+)/)?.[1];
    if (range) requestedRanges.push(range);
    if (decodedUrl.includes('/values/')) return jsonResponse({});
    if (decodedUrl.includes(':batchUpdate')) return jsonResponse({});
    if (decodedUrl.includes('/spreadsheets/')) {
      return jsonResponse({ sheets: [{ properties: { sheetId: 9, title: 'Late Orders', gridProperties: { rowCount: 100, columnCount: 9 } } }] });
    }
    throw new Error(`Unexpected mock request: ${method} ${decodedUrl}`);
  };

  try {
    await syncLateOrdersGoogle({
      token: 'token',
      config: { master: { id: spreadsheetId } },
      orders: [{ platform: 'shopee', orderId: '1', trackingNo: 'TH1', marketplaceSkus: [], expectedShipAt: '', sellerOrderStatus: '', scanned: true }],
      now: new Date('2026-08-25T03:00:00Z'),
    });

    // A bare `Late Orders!A1:I` is rejected by the Sheets API because the name has a space.
    assert.ok(requestedRanges.length > 0);
    requestedRanges.forEach((range) => assert.ok(range.startsWith("'Late Orders'!"), range));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a cross-day Admin merge records the courier the Packer actually picked', async () => {
  const originalFetch = globalThis.fetch;
  const today = '2026-08-25';
  const yesterday = '2026-08-24';
  const spreadsheetId = 'sheet-wrong-courier-test';
  const code = 'TH2695488345554';
  const sheetProperties = {
    sheets: [
      { properties: { sheetId: 124, title: yesterday, gridProperties: { rowCount: 1000, columnCount: 23 } } },
      { properties: { sheetId: 125, title: today, gridProperties: { rowCount: 1000, columnCount: 23 } } },
    ],
  };
  const rowsByDate = new Map([
    // Admin filed this parcel under Shopee yesterday; the Packer picks Flash today.
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
      courier: 'Flash',
      code,
      email: 'packer@example.com',
      packer: 'เบ้น',
      scanDate: today,
      scanTime: '10:20:30',
    });

    assert.equal(result.status, 'success');
    assert.equal(result.wrongCourier, true);
    assert.equal(result.courier, 'Shopee');
    assert.equal(result.selectedCourier, 'Flash');
    assert.equal(rowsByDate.get(today).length, 0);
    assert.ok(
      String(rowsByDate.get(yesterday)[0][9]).includes('แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก Flash)'),
      rowsByDate.get(yesterday)[0][9],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
