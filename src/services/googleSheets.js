const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
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
  'Scan Date',
  'Scan Time',
  'Tracking / Barcode',
  'Scanner Email',
  'Status',
  'Note',
];

const STORAGE_KEY = 'scan-to-sheet-demo-v1';
const CONFIG_KEY = 'scan-to-sheet-google-config-v1';
const FOLDER_NAME = 'Scan to Sheet';
const TIMEZONE = 'Asia/Bangkok';

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

export function loadLocalState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveLocalState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

export function resetDemoData() {
  localStorage.removeItem(STORAGE_KEY);
}

export async function fetchGoogleProfile(token) {
  return apiFetch(USERINFO_API, token);
}

function normalizeCode(value) {
  return String(value ?? '').trim();
}

function getSheetRows(state, courier, date) {
  return state?.[courier]?.[date] ?? [];
}

export async function appendScanLocal({ courier, code, email, note = '' }) {
  const normalizedCode = normalizeCode(code);
  const { date, time } = getBangkokParts();
  const state = loadLocalState();
  const courierState = state[courier] ?? {};
  const rows = courierState[date] ?? [];
  const duplicate = rows.some((row) => row.code.toLowerCase() === normalizedCode.toLowerCase());

  if (duplicate) {
    return {
      status: 'duplicate',
      courier,
      date,
      time,
      code: normalizedCode,
      count: rows.length,
      rows,
    };
  }

  const row = {
    no: rows.length + 1,
    date,
    time,
    code: normalizedCode,
    email,
    status: 'Success',
    note,
  };

  const nextRows = [row, ...rows];
  state[courier] = {
    ...courierState,
    [date]: nextRows,
  };
  saveLocalState(state);

  return {
    status: 'success',
    courier,
    date,
    time,
    code: normalizedCode,
    count: nextRows.length,
    row,
    rows: nextRows,
  };
}

export function getLocalSummary(date = getBangkokParts().date) {
  const state = loadLocalState();
  return COURIERS.map((courier) => ({
    courier,
    count: getSheetRows(state, courier, date).length,
  }));
}

export function getLocalRows(courier, date = getBangkokParts().date) {
  return getSheetRows(loadLocalState(), courier, date);
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

async function createSpreadsheetInFolder({ token, name, parentId }) {
  const { body, contentType } = buildMultipartBody({
    metadata: {
      name,
      mimeType: MIME_SHEET,
      parents: [parentId],
    },
    content: '',
  });

  const response = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType,
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google API error ${response.status}: ${detail}`);
  }

  return response.json();
}

function buildMultipartBody({ metadata, content }) {
  const boundary = `scan_to_sheet_${Date.now()}`;
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelimiter = `\r\n--${boundary}--`;
  const body =
    `${delimiter}Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}` +
    `${delimiter}Content-Type: text/plain\r\n\r\n` +
    `${content}` +
    closeDelimiter;

  const blob = new Blob([body], {
    type: `multipart/related; boundary=${boundary}`,
  });
  return {
    body: blob,
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

export async function prepareGoogleSheets(token) {
  let folder = await findDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
  if (!folder) {
    folder = await createDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
  }

  const sheets = {};
  for (const courier of COURIERS) {
    let file = await findDriveItem({
      token,
      name: courier,
      mimeType: MIME_SHEET,
      parentId: folder.id,
    });

    if (!file) {
      file = await createSpreadsheetInFolder({
        token,
        name: courier,
        parentId: folder.id,
      });
    }

    sheets[courier] = file;
  }

  const config = {
    folder,
    sheets,
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
    return existing.properties;
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

  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${date}!A1:G1`)}?valueInputOption=RAW`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: [SCAN_HEADERS],
      }),
    },
  );

  return getSpreadsheet(token, spreadsheetId).then((data) =>
    data.sheets.find((sheet) => sheet.properties.title === date)?.properties,
  );
}

async function readDailyRows({ token, spreadsheetId, date }) {
  const range = `${escapeSheetName(date)}!A2:G`;
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
  });
  const data = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?${params}`,
    token,
  );
  return data.values ?? [];
}

export async function appendScanGoogle({ token, config, courier, code, email, note = '' }) {
  const normalizedCode = normalizeCode(code);
  const sheet = config?.sheets?.[courier];
  if (!sheet?.id) {
    throw new Error(`ไม่พบ Google Sheet ของ ${courier}`);
  }

  const { date, time } = getBangkokParts();
  await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });
  const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const duplicate = rows.some((row) => String(row[3] ?? '').trim().toLowerCase() === normalizedCode.toLowerCase());

  if (duplicate) {
    return {
      status: 'duplicate',
      courier,
      date,
      time,
      code: normalizedCode,
      count: rows.length,
      rows: rows.map(rowFromSheet).reverse(),
      sheetUrl: sheet.webViewLink,
    };
  }

  const row = [
    rows.length + 1,
    date,
    time,
    normalizedCode,
    email,
    'Success',
    note,
  ];
  const range = `${escapeSheetName(date)}!A:G`;
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
    count: rows.length + 1,
    row: rowFromSheet(row),
    rows: [rowFromSheet(row), ...rows.map(rowFromSheet).reverse()].slice(0, 20),
    sheetUrl: sheet.webViewLink,
  };
}

function rowFromSheet(row) {
  return {
    no: row[0],
    date: row[1],
    time: row[2],
    code: row[3],
    email: row[4],
    status: row[5],
    note: row[6] ?? '',
  };
}
