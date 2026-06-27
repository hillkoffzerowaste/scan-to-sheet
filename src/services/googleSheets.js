const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo';
const MIME_FOLDER = 'application/vnd.google-apps.folder';
const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';

export const COURIERS = [
  'Shopee',
  'Shopee Drop Off',
  'Lazada',
  'KEX Lazada',
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
  'KEX Lazada': {
    label: 'เลข KEX Lazada ต้องขึ้นต้นด้วย KEXLM แล้วตามด้วยตัวเลข',
    valid: /^KEXLM\d{8,20}$/i,
  },
  'Lazada Flash': {
    label: 'เลข Lazada Flash ต้องขึ้นต้นด้วย TH',
    valid: /^TH[A-Z0-9]{8,18}$/i,
  },
  'J&T': {
    label: 'เลข J&T ต้องเป็นตัวเลข 12 หลัก',
    valid: /^\d{12}$/,
  },
  Shopee: {
    label: 'เลข Shopee ต้องขึ้นต้นด้วย TH แล้วตามด้วยตัวเลข 10-14 หลัก',
    valid: /^TH\d{10,14}[A-Z]?$/i,
  },
  'Shopee Drop Off': {
    label: 'เลข Shopee Drop Off ต้องขึ้นต้นด้วย TH แล้วตามด้วยตัวเลข 10-14 หลัก',
    valid: /^TH\d{10,14}[A-Z]?$/i,
  },
  Flash: {
    label: 'เลข Flash ต้องขึ้นต้นด้วย TH',
    valid: /^TH[A-Z0-9]{10,16}$/i,
  },
  Best: {
    label: 'เลข Best ต้องเป็นตัวเลข 10-18 หลัก',
    valid: /^\d{10,18}$/,
  },
  Ratika: {
    label: 'เลข Ratika ต้องเป็นตัวอักษรหรือตัวเลข 6-30 ตัว',
    valid: /^[A-Z0-9]{6,30}$/i,
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
  const maxRetries = 2;
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers ?? {}),
      },
    });

    if (response.status === 429 && attempt < maxRetries) {
      // Rate limited — wait and retry with exponential backoff
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Google API error ${response.status}: ${detail}`);
    }

    if (response.status === 204) {
      return null;
    }

    return response.json();
  }

  throw lastError ?? new Error('Google API max retries exceeded');
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function escapeSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

async function findDriveItem({ token, name, mimeType, parentId }) {
  const items = await listDriveItems({ token, name, mimeType, parentId, pageSize: 1 });
  return items[0] ?? null;
}

async function listDriveItems({ token, name, mimeType, parentId, pageSize = 50 }) {
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
    pageSize: String(pageSize),
  });

  const data = await apiFetch(`${DRIVE_API}/files?${params}`, token);
  return data.files ?? [];
}

async function chooseBestMasterSheet({ token, candidates }) {
  const uniqueCandidates = [...new Map(candidates.filter(Boolean).map((item) => [item.id, item])).values()];
  if (uniqueCandidates.length <= 1) {
    return uniqueCandidates[0] ?? null;
  }

  const scoredCandidates = await Promise.all(
    uniqueCandidates.map(async (candidate) => {
      try {
        const spreadsheet = await getSpreadsheet(token, candidate.id);
        const dateSheets =
          spreadsheet.sheets?.filter((sheet) => /^\d{4}-\d{2}-\d{2}$/.test(sheet.properties.title)) ?? [];
        const latestDate = dateSheets.map((sheet) => sheet.properties.title).sort().at(-1) ?? '';
        const rowCounts = await Promise.all(
          dateSheets.map(async (sheet) => {
            const rows = await readDailyRows({ token, spreadsheetId: candidate.id, date: sheet.properties.title });
            return rows.filter((row) => row.some((cell) => String(cell ?? '').trim())).length;
          }),
        );
        const rowCount = rowCounts.reduce((sum, count) => sum + count, 0);
        return {
          candidate,
          score: dateSheets.length * 100000 + rowCount,
          latestDate,
        };
      } catch {
        return { candidate, score: 0, latestDate: '' };
      }
    }),
  );

  scoredCandidates.sort((a, b) => b.score - a.score || b.latestDate.localeCompare(a.latestDate));
  return scoredCandidates[0]?.candidate ?? null;
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
  // --- BEGIN FIX: Bug 4 — prevent concurrent duplicate folder creation ---
  // When two machines call prepareGoogleSheets at the same time, both see
  // no folder → both create one.  We re-read right before creating to
  // catch any folder that another machine just created.
  let folder = await findDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
  if (!folder) {
    // Re-check immediately before creating to avoid a race window.
    const preCreateFolder = await findDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
    if (preCreateFolder) {
      folder = preCreateFolder;
    } else {
      try {
        folder = await createDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
      } catch (error) {
        // If another machine created the folder between our re-check and
        // our create call, Google may return a conflict.  Look it up once
        // more and use whichever folder exists.
        if (String(error).includes('409') || String(error).includes('already exists')) {
          folder = await findDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
        }
        if (!folder) {
          throw error;
        }
      }
    }
  }
  // --- END FIX ---

  const folderMasters = await listDriveItems({
    token,
    name: MASTER_SHEET_NAME,
    mimeType: MIME_SHEET,
    parentId: folder.id,
  });
  const allMasters = await listDriveItems({
    token,
    name: MASTER_SHEET_NAME,
    mimeType: MIME_SHEET,
  });
  let master = await chooseBestMasterSheet({
    token,
    candidates: [...folderMasters, ...allMasters],
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
  // --- BEGIN FIX: Bug 3 — prevent concurrent duplicate worksheet creation ---
  // Re-read the spreadsheet immediately before creating a new sheet so we
  // catch any sheet that another machine just created between our last read
  // and this write.  Google Sheets allows duplicate sheet titles, so we
  // *must* check right before adding.
  const preCreateSpreadsheet = await getSpreadsheet(token, spreadsheetId);
  const preExisting = preCreateSpreadsheet.sheets?.find((sheet) => sheet.properties.title === date);
  if (preExisting) {
    await ensureWorksheetReady({ token, spreadsheetId, date, sheetId: preExisting.properties.sheetId });
    return preExisting.properties;
  }

  const reusableDefaultSheet = preCreateSpreadsheet.sheets?.find((sheet) => {
    const title = sheet.properties.title;
    const rowCount = sheet.properties.gridProperties?.rowCount ?? 0;
    return preCreateSpreadsheet.sheets.length === 1 && rowCount <= 1000 && [
      'Sheet1',       // English
      'ชีต1',          // Thai
      'シート1',       // Japanese
      '시트1',         // Korean
      '工作表1',        // Chinese Simplified
      'Feuille 1',    // French
      'Tabelle1',     // German
      'Hoja 1',       // Spanish
      'Página1',      // Portuguese
      'Foglio1',      // Italian
      'Лист1',        // Russian
    ].includes(title);
  });

  if (reusableDefaultSheet) {
    try {
      await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
        method: 'POST',
        body: JSON.stringify({
          requests: [
            {
              updateSheetProperties: {
                properties: {
                  sheetId: reusableDefaultSheet.properties.sheetId,
                  title: date,
                  index: 0,
                  gridProperties: {
                    rowCount: 1000,
                    columnCount: SCAN_HEADERS.length,
                  },
                },
                fields: 'title,index,gridProperties(rowCount,columnCount)',
              },
            },
          ],
        }),
      });
    } catch (error) {
      // If another machine renamed the default sheet at the same time,
      // the rename will fail.  Fall back to find-or-add below.
      if (!String(error).includes('already exists') && !String(error).includes('duplicate')) {
        throw error;
      }
    }

    const postRenameSpreadsheet = await getSpreadsheet(token, spreadsheetId);
    const worksheet = postRenameSpreadsheet.sheets.find((sheet) => sheet.properties.title === date)?.properties;
    if (worksheet) {
      await ensureWorksheetReady({ token, spreadsheetId, date, sheetId: worksheet.sheetId });
    }
    return worksheet;
  }

  try {
    await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: date,
                index: 0,
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
  } catch (error) {
    // If Google already created a sheet with this title (unlikely with
    // our re-check above, but possible under extreme concurrency), look
    // it up again and use the existing one.
    if (!String(error).includes('already exists') && !String(error).includes('duplicate')) {
      throw error;
    }
  }

  // Final re-read to pick up whichever sheet ended up with the target
  // date title (ours or another machine’s).
  const postCreateSpreadsheet = await getSpreadsheet(token, spreadsheetId);
  const worksheet = postCreateSpreadsheet.sheets.find((sheet) => sheet.properties.title === date)?.properties;
  if (worksheet) {
    await ensureWorksheetReady({ token, spreadsheetId, date, sheetId: worksheet.sheetId });
  }
  return worksheet;
  // --- END FIX ---
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

async function updateDailyRow({ token, spreadsheetId, date, rowNumber, row }) {
  const range = `${escapeSheetName(date)}!A${rowNumber}:J${rowNumber}`;
  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: [row],
      }),
    },
  );
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

export async function fetchTodayPackerCounts({ token, config }) {
  const sheet = config?.master;
  if (!sheet?.id) {
    return [];
  }

  const date = getBangkokParts().date;
  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const worksheet = spreadsheet.sheets?.find((item) => item.properties.title === date);
  if (!worksheet) {
    return [];
  }

  // Read only the Packer (H) and Status (I) columns for today
  const range = `${escapeSheetName(date)}!H2:I`;
  const params = new URLSearchParams({ majorDimension: 'ROWS' });
  const data = await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(range)}?${params}`,
    token,
  );
  const rows = data.values ?? [];

  const packerMap = Object.fromEntries(
    PACKERS.filter((p) => p !== PACKER_UNASSIGNED).map((p) => [p, 0]),
  );

  for (const row of rows) {
    const packer = row[0]; // Column H
    const status = row[1]; // Column I
    if (status === 'Success' && packer && packerMap[packer] !== undefined) {
      packerMap[packer] += 1;
    }
  }

  return Object.entries(packerMap).map(([packer, count]) => ({ packer, count }));
}

export async function getScanReportGoogle({ token, config, dates }) {
  const uniqueDates = [...new Set(dates)].filter(Boolean).sort();
  const dayMap = new Map(
    uniqueDates.map((date) => [
      date,
      {
        date,
        total: 0,
        cancelledTotal: 0,
        damagedTotal: 0,
        couriers: COURIERS.map((courier) => ({ courier, count: 0 })),
      },
    ]),
  );
  const courierTotals = COURIERS.map((courier) => ({ courier, count: 0 }));
  const cancelledRows = [];
  const damagedRows = [];
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
      const isCancelled = row.status === 'Cancelled' || row.note === 'ลูกค้ายกเลิก';
      if (isCancelled) {
        day.cancelledTotal += 1;
        cancelledRows.push(row);
        continue;
      }

      const isDamaged = row.status === 'Damaged' || row.note === 'สินค้าเสียหาย';
      if (isDamaged) {
        day.damagedTotal += 1;
        damagedRows.push(row);
        continue;
      }

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
    cancelledTotal: cancelledRows.length,
    cancelledRows: cancelledRows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
    damagedTotal: damagedRows.length,
    damagedRows: damagedRows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
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
  const isCancelled = note === 'ลูกค้ายกเลิก';
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const { date, time } = getBangkokParts();
  await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });
  const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const parsedRows = rows.map(rowFromSheet);
  const courierRows = parsedRows.filter((row) => row.courier === courier);
  const duplicateRow = courierRows.find((row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode));
  const duplicate = Boolean(duplicateRow);

  if (duplicateRow && isCancelled) {
    // --- BEGIN FIX: Concurrent safety for cancellation path ---
    // Re-read the sheet to get the current accurate row position.
    // The initial read may be stale if another machine inserted rows.
    const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    const verifyParsed = verifyRows.map(rowFromSheet);
    const verifyCourierRows = verifyParsed.filter((row) => row.courier === courier);
    const verifyIdx = verifyCourierRows.findIndex(
      (row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
    );

    if (verifyIdx !== -1) {
      const currentRow = verifyCourierRows[verifyIdx];
      // Find the global index in all rows to compute the accurate sheet row number.
      const globalIdx = verifyParsed.findIndex(
        (row) =>
          row.courier === courier &&
          normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
      );
      const rowNumber = globalIdx + 2; // +1 for header, +1 for zero-based index

      const updatedRow = [
        currentRow.no,
        currentRow.courierNo,
        currentRow.date,
        currentRow.time,
        currentRow.courier,
        currentRow.code,
        currentRow.email,
        currentRow.packer,
        'Cancelled',
        note,
      ];
      await updateDailyRow({ token, spreadsheetId: sheet.id, date, rowNumber, row: updatedRow });

      const nextRows = verifyParsed
        .map((row) => (row.no === currentRow.no ? rowFromSheet(updatedRow) : row))
        .filter((row) => row.courier === courier)
        .reverse();
      return {
        status: 'cancelled',
        courier,
        date,
        time,
        code: normalizedCode,
        count: verifyCourierRows.length,
        rows: nextRows,
        sheetUrl: sheet.webViewLink,
      };
    }
    // Row was deleted/moved by another machine — fall through to BEGIN FIX
    // which will insert it correctly as a new cancelled scan.
    // --- END FIX: Concurrent safety for cancellation path ---
  }

  if (duplicate && !isCancelled) {
    return {
      status: 'duplicate',
      courier,
      date,
      time,
      code: normalizedCode,
      count: courierRows.length,
      rows: courierRows.reverse().slice(0, 20),
      sheetUrl: sheet.webViewLink,
    };
  }

  // --- BEGIN FIX: Bug 1 & 2 — race-condition-safe append ---
  //
  // Use a unique placeholder for No. and Courier No. so we can find our row
  // after the append and compute the correct sequence numbers from the
  // sheet’s real state.  This prevents concurrent machines from assigning
  // the same No./Courier No. and also lets us detect concurrent duplicates.
  const placeholder = `_TEMP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const placeholderRow = [
    placeholder,
    placeholder,
    date,
    time,
    courier,
    normalizedCode,
    email,
    packer,
    isCancelled ? 'Cancelled' : 'Success',
    note,
  ];

  const range = `${escapeSheetName(date)}!A:J`;
  await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        values: [placeholderRow],
      }),
    },
  );

  // Re-read the sheet to determine the actual position of the row we just
  // inserted.  This eliminates the race condition where two machines read
  // the same row-count and then both assign the same No.
  const updatedRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const updatedParsedRows = updatedRows.map((row, idx) => rowFromSheet(row, idx));
  const insertedIdx = updatedParsedRows.findIndex((row) => String(row.no) === placeholder);

  if (insertedIdx === -1) {
    // Fallback — should not happen.  Return a best-effort result using the
    // current sheet state.
    const courierCount = updatedParsedRows.filter((row) => row.courier === courier).length;
    return {
      status: 'success',
      courier,
      date,
      time,
      code: normalizedCode,
      count: courierCount,
      rows: updatedParsedRows.filter((row) => row.courier === courier).reverse().slice(0, 20),
      sheetUrl: sheet.webViewLink,
    };
  }

  const updatedCourierRows = updatedParsedRows.filter((row) => row.courier === courier);

  // Check whether another machine appended the same tracking code between
  // our initial read and our append (concurrent duplicate).
  const concurrentCodes = updatedCourierRows.filter(
    (row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
  );

  const concurrentDuplicate = concurrentCodes.length > 1;

  // Calculate the correct No. (1-based overall row index in this date sheet)
  // and Courier No. (1-based index among this courier’s rows).
  const correctNo = insertedIdx + 1;
  const correctCourierNo =
    updatedCourierRows.findIndex((row) => String(row.no) === placeholder) + 1;

  const correctedRow = [
    correctNo,
    correctCourierNo,
    date,
    time,
    courier,
    normalizedCode,
    email,
    packer,
    concurrentDuplicate ? 'Duplicate' : isCancelled ? 'Cancelled' : 'Success',
    concurrentDuplicate ? 'Duplicate (concurrent scan)' : note,
  ];

  // Update the placeholder row with the real sequence numbers.
  await updateDailyRow({
    token,
    spreadsheetId: sheet.id,
    date,
    rowNumber: insertedIdx + 2, // +1 header row, +1 zero-based index
    row: correctedRow,
  });

  // Build the return payload from the in-memory corrected state so we avoid
  // a third round-trip.
  const resultRows = updatedParsedRows
    .filter((row) => row.courier === courier)
    .map((row) => (String(row.no) === placeholder ? rowFromSheet(correctedRow) : row))
    .reverse()
    .slice(0, 20);

  return {
    status: concurrentDuplicate ? 'duplicate' : isCancelled ? 'cancelled' : 'success',
    courier,
    date,
    time,
    code: normalizedCode,
    count: concurrentDuplicate
      ? updatedCourierRows.length
      : updatedCourierRows.filter((row) => normalizeScanCode(row.code) !== placeholder).length + 1,
    row: rowFromSheet(correctedRow),
    rows: resultRows,
    sheetUrl: sheet.webViewLink,
  };
  // --- END FIX ---
}

export async function updateScanIssueGoogle({ token, config, row, issue }) {
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  // --- BEGIN FIX: Concurrent safety — re-read before updating row position ---
  // The row.sheetRowNumber may be stale if another machine inserted/removed rows.
  const currentRows = await readDailyRows({ token, spreadsheetId: sheet.id, date: row.date });
  const currentParsed = currentRows.map(rowFromSheet);
  const targetIdx = currentParsed.findIndex(
    (r) => normalizeScanCode(r.code) === normalizeScanCode(row.code) && r.courier === row.courier,
  );

  if (targetIdx === -1) {
    throw new Error('ไม่พบรายการใน Google Sheet (อาจถูกลบหรือย้ายแล้ว)');
  }

  const currentRow = currentParsed[targetIdx];
  const rowNumber = targetIdx + 2; // +1 for header, +1 for zero-based index
  // --- END FIX ---

  const status = issue === 'สินค้าเสียหาย' ? 'Damaged' : issue === 'ลูกค้ายกเลิก' ? 'Cancelled' : 'Issue';
  const updatedRow = [
    currentRow.no,
    currentRow.courierNo,
    currentRow.date,
    currentRow.time,
    currentRow.courier,
    currentRow.code,
    currentRow.email,
    currentRow.packer,
    status,
    issue,
  ];

  await updateDailyRow({
    token,
    spreadsheetId: sheet.id,
    date: row.date,
    rowNumber,
    row: updatedRow,
  });

  return {
    ...rowFromSheet(updatedRow),
    sheetUrl: sheet.webViewLink,
  };
}

function rowFromSheet(row, index = null) {
  const hasPackerColumn = row.length >= 10;
  return {
    no: row[0],
    sheetRowNumber: index === null ? null : index + 2,
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
