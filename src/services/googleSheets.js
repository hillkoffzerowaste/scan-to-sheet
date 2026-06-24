const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo';
const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';

export const COURIERS = [
  'Shopee',
  'Shopee Drop Off',
  'Lazada',
  'Lazada Flash',
  'J&T',
  'Flash',
  'Best',
  'Ratika',
];

export const SCAN_HEADERS = [
  'No.',
  'Courier No.',
  'Scan Date',
  'Scan Time',
  'Courier',
  'Tracking / Barcode',
  'Scanner Email',
  'Packer',
  'Status',
  'Remark / Issue',
];

export const COURIER_RULES = {
  Lazada: {
    label: 'เลข Lazada ต้องขึ้นต้นด้วย LEX',
    valid: /^LEX[A-Z0-9]{8,35}$/i,
  },
  'Lazada Flash': {
    label: 'เลข Lazada Flash ต้องขึ้นต้นด้วย TH',
    valid: /^TH[A-Z0-9]{8,18}$/i,
  },
};

const CONFIG_KEY = 'scan-to-sheet-google-config-v2';
const FOLDER_NAME = 'Scan to Sheet';
const MASTER_SHEET_NAME = 'Scan to Sheet Master';
const TIMEZONE = 'Asia/Bangkok';
const formattedWorksheetKeys = new Set();

export function getBangkokParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
  };
}

export function loadGoogleConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) ?? null;
  } catch {
    return null;
  }
}

export function saveGoogleConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

export async function fetchGoogleProfile(token) {
  return apiFetch(USERINFO_API, token);
}

function normalizeCode(value) {
  return String(value ?? '').trim();
}

export function normalizeScanCode(value) {
  return normalizeCode(value).toUpperCase();
}

export function validateScanCode(courier, value) {
  const normalizedCode = normalizeScanCode(value);
  const rule = COURIER_RULES[courier];

  if (!normalizedCode) {
    return {
      ok: false,
      code: normalizedCode,
      reason: 'ยังไม่มีเลขสแกน',
    };
  }

  if (!rule) {
    return {
      ok: true,
      code: normalizedCode,
      reason: '',
    };
  }

  if (!rule.valid.test(normalizedCode)) {
    return {
      ok: false,
      code: normalizedCode,
      reason: `${normalizedCode} ไม่ใช่บาร์โค้ดหลักของ ${courier} (${rule.label})`,
    };
  }

  return {
    ok: true,
    code: normalizedCode,
    reason: '',
  };
}

async function apiFetch(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google API error ${response.status}: ${detail}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function escapeQuery(value) {
  return String(value).replace(/'/g, "\\'");
}

function escapeSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

async function findDriveItem({ token, name, mimeType, parentId }) {
  const clauses = [
    `name='${escapeQuery(name)}'`,
    `mimeType='${mimeType}'`,
    'trashed=false',
  ];
  if (parentId) {
    clauses.push(`'${parentId}' in parents`);
  }

  const params = new URLSearchParams({
    q: clauses.join(' and '),
    fields: 'files(id,name,webViewLink)',
    pageSize: '1',
  });

  const data = await apiFetch(`${DRIVE_API}/files?${params}`, token);
  return data.files?.[0] ?? null;
}

async function createDriveItem({ token, name, mimeType, parentId }) {
  return apiFetch(`${DRIVE_API}/files?fields=id,name,webViewLink`, token, {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType,
      parents: parentId ? [parentId] : undefined,
    }),
  });
}

export async function prepareGoogleSheets(token) {
  let folder = await findDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
  if (!folder) {
    folder = await createDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
  }

  let master = await findDriveItem({
    token,
    name: MASTER_SHEET_NAME,
    mimeType: MIME_SHEET,
    parentId: folder.id,
  });

  if (!master) {
    master = await createDriveItem({
      token,
      name: MASTER_SHEET_NAME,
      mimeType: MIME_SHEET,
      parentId: folder.id,
    });
  }

  const config = {
    folder,
    master,
    preparedAt: new Date().toISOString(),
  };
  saveGoogleConfig(config);
  return config;
}

async function getSpreadsheet(token, spreadsheetId) {
  return apiFetch(
    `${SHEETS_API}/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`,
    token,
  );
}

async function ensureDailyWorksheet({ token, spreadsheetId, date }) {
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const existing = spreadsheet.sheets?.find((sheet) => sheet.properties.title === date);
  if (existing) {
    await ensureWorksheetReady({ token, spreadsheetId, date, sheetId: existing.properties.sheetId });
    return existing.properties;
  }

  const reusableDefaultSheet = spreadsheet.sheets?.find((sheet) => {
    const title = sheet.properties.title;
    const rowCount = sheet.properties.gridProperties?.rowCount ?? 0;
    return spreadsheet.sheets.length === 1 && rowCount <= 1000 && ['Sheet1', 'ชีต1'].includes(title);
  });

  if (reusableDefaultSheet) {
    await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId: reusableDefaultSheet.properties.sheetId,
                title: date,
                gridProperties: {
                  rowCount: 1000,
                  columnCount: SCAN_HEADERS.length,
                },
              },
              fields: 'title,gridProperties(rowCount,columnCount)',
            },
          },
        ],
      }),
    });

    const updatedSpreadsheet = await getSpreadsheet(token, spreadsheetId);
    const worksheet = updatedSpreadsheet.sheets.find((sheet) => sheet.properties.title === date)?.properties;
    if (worksheet) {
      await ensureWorksheetReady({ token, spreadsheetId, date, sheetId: worksheet.sheetId });
    }
    return worksheet;
  }

  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          addSheet: {
            properties: {
              title: date,
              gridProperties: {
                rowCount: 1000,
                columnCount: SCAN_HEADERS.length,
              },
            },
          },
        },
      ],
    }),
  });

  const updatedSpreadsheet = await getSpreadsheet(token, spreadsheetId);
  const worksheet = updatedSpreadsheet.sheets.find((sheet) => sheet.properties.title === date)?.properties;
  if (worksheet) {
    await ensureWorksheetReady({ token, spreadsheetId, date, sheetId: worksheet.sheetId });
  }
  return worksheet;
}

async function ensureWorksheetReady({ token, spreadsheetId, date, sheetId }) {
  const key = `${spreadsheetId}:${date}`;
  if (formattedWorksheetKeys.has(key)) {
    return;
  }

  await writeHeaders({ token, spreadsheetId, date });
  await formatDailyWorksheet({ token, spreadsheetId, sheetId });
  formattedWorksheetKeys.add(key);
}

async function writeHeaders({ token, spreadsheetId, date }) {
  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${date}!A1:J1`)}?valueInputOption=RAW`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: [SCAN_HEADERS],
      }),
    },
  );
}

async function formatDailyWorksheet({ token, spreadsheetId, sheetId }) {
  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 1,
                columnCount: SCAN_HEADERS.length,
              },
            },
            fields: 'gridProperties(frozenRowCount,columnCount)',
          },
        },
        {
          setBasicFilter: {
            filter: {
              range: {
                sheetId,
                startRowIndex: 0,
                startColumnIndex: 0,
                endColumnIndex: SCAN_HEADERS.length,
              },
            },
          },
        },
      ],
    }),
  });
}

async function readDailyRows({ token, spreadsheetId, date }) {
  const range = `${escapeSheetName(date)}!A2:J`;
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
  });
  const data = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?${params}`,
    token,
  );
  return data.values ?? [];
}

export async function getTodayRowsGoogle({ token, config, courier, date = getBangkokParts().date }) {
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const worksheet = spreadsheet.sheets?.find((item) => item.properties.title === date);
  if (!worksheet) {
    return [];
  }

  const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  return rows.map(rowFromSheet).filter((row) => row.courier === courier).reverse();
}

export async function getScanReportGoogle({ token, config, dates }) {
  const uniqueDates = [...new Set(dates)].filter(Boolean).sort();
  const dayMap = new Map(
    uniqueDates.map((date) => [
      date,
      {
        date,
        total: 0,
        couriers: COURIERS.map((courier) => ({ courier, count: 0 })),
      },
    ]),
  );
  const courierTotals = COURIERS.map((courier) => ({ courier, count: 0 }));
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const sheetTitles = new Set(spreadsheet.sheets?.map((item) => item.properties.title) ?? []);

  for (const date of uniqueDates) {
    if (!sheetTitles.has(date)) {
      continue;
    }

    const rows = (await readDailyRows({ token, spreadsheetId: sheet.id, date })).map(rowFromSheet);
    const day = dayMap.get(date);

    for (const row of rows) {
      const dayCourier = day.couriers.find((item) => item.courier === row.courier);
      const totalCourier = courierTotals.find((item) => item.courier === row.courier);
      if (!dayCourier || !totalCourier) {
        continue;
      }

      dayCourier.count += 1;
      totalCourier.count += 1;
      day.total += 1;
    }
  }

  const days = [...dayMap.values()];
  return {
    days,
    couriers: courierTotals,
    total: courierTotals.reduce((sum, item) => sum + item.count, 0),
    generatedAt: new Date().toISOString(),
  };
}

export async function searchScansGoogle({ token, config, query, couriers = COURIERS, dates = null, limit = 50 }) {
  const normalizedQuery = normalizeScanCode(query);
  if (!normalizedQuery) {
    return [];
  }

  const results = [];
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const courierSet = new Set(couriers);
  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const sheetTitles = spreadsheet.sheets?.map((item) => item.properties.title) ?? [];
  const searchDates = dates
    ? dates.filter((date) => sheetTitles.includes(date))
    : sheetTitles.filter((title) => /^\d{4}-\d{2}-\d{2}$/.test(title));

  for (const date of searchDates) {
    const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    for (const row of rows) {
      const item = rowFromSheet(row);
      const code = normalizeScanCode(item.code);
      if (courierSet.has(item.courier) && code.includes(normalizedQuery)) {
        results.push({
          ...item,
          sheetUrl: sheet.webViewLink,
        });
      }
    }
  }

  return results
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`))
    .slice(0, limit);
}

export function listDatesBetween(startDate, endDate) {
  if (!startDate || !endDate) {
    return [];
  }

  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  if (!start || !end || start > end) {
    return [];
  }

  const dates = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    dates.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function listDatesInMonth(yearMonth) {
  if (!/^\d{4}-\d{2}$/.test(yearMonth ?? '')) {
    return [];
  }

  const [year, month] = yearMonth.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1, 1));
  const dates = [];
  const cursor = new Date(first);

  while (cursor.getUTCFullYear() === year && cursor.getUTCMonth() === month - 1) {
    dates.push(formatDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

export async function appendScanGoogle({ token, config, courier, code, email, packer = '', note = '' }) {
  const normalizedCode = normalizeCode(code);
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const { date, time } = getBangkokParts();
  await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });
  const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const parsedRows = rows.map(rowFromSheet);
  const courierRows = parsedRows.filter((row) => row.courier === courier);
  const duplicate = courierRows.some((row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode));

  if (duplicate) {
    return {
      status: 'duplicate',
      courier,
      date,
      time,
      code: normalizedCode,
      count: courierRows.length,
      rows: courierRows.reverse(),
      sheetUrl: sheet.webViewLink,
    };
  }

  const row = [
    rows.length + 1,
    courierRows.length + 1,
    date,
    time,
    courier,
    normalizedCode,
    email,
    packer,
    'Success',
    note,
  ];
  const range = `${escapeSheetName(date)}!A:J`;
  await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        values: [row],
      }),
    },
  );

  return {
    status: 'success',
    courier,
    date,
    time,
    code: normalizedCode,
    count: courierRows.length + 1,
    row: rowFromSheet(row),
    rows: [rowFromSheet(row), ...courierRows.reverse()].slice(0, 20),
    sheetUrl: sheet.webViewLink,
  };
}

function rowFromSheet(row) {
  const hasPackerColumn = row.length >= 10;
  return {
    no: row[0],
    courierNo: row[1],
    date: row[2],
    time: row[3],
    courier: row[4],
    code: row[5],
    email: row[6],
    packer: hasPackerColumn ? row[7] : '',
    status: hasPackerColumn ? row[8] : row[7],
    note: hasPackerColumn ? row[9] ?? '' : row[8] ?? '',
  };
}

function parseDateOnly(date) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    return null;
  }
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function formatDateOnly(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
