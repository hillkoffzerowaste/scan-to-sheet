import { buildSheetBackfillUpdates, classifyLateOrder } from './marketplaceImport.js';
import { findHistoricalIssueRow, findScanReconciliation, getScanIssueMeta, resolveCrossDayPackerRow } from './sheetSyncReconciliation.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
export const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const USERINFO_API = 'https://www.googleapis.com/oauth2/v3/userinfo';
export const GOOGLE_API_TIMEOUT_MS = 25_000;
const MIME_FOLDER = 'application/vnd.google-apps.folder';
export const MIME_SHEET = 'application/vnd.google-apps.spreadsheet';

export const COURIERS = [
  'Shopee',
  'Shopee Drop Off',
  'Lazada',
  'KEX Lazada',
  'Lazada Flash',
  'TikTok Flash',
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

export const ADMIN_HEADERS = [
  'Admin Scan Date',
  'Admin Scan Time',
  'Admin Tracking / Barcode',
];

export const MARKETPLACE_HEADERS = [
  'Marketplace Platform',
  'Order ID',
  'Buyer Name',
  'Items',
  'SKUs',
  'Item Qty',
  'Marketplace Status',
];

export const SHEET_METADATA_HEADERS = ['Order Status', 'Cross-day', 'Sync Status'];

export const ALL_HEADERS = [...SCAN_HEADERS, ...ADMIN_HEADERS, ...MARKETPLACE_HEADERS, ...SHEET_METADATA_HEADERS];

export const TOTAL_COLUMNS = ALL_HEADERS.length; // 23

export const COURIER_RULES = {
  Lazada: {
    label: 'เลข Lazada ต้องขึ้นต้นด้วย LEX',
    valid: /^LEX[A-Z0-9]{8,35}$/i,
  },
  'KEX Lazada': {
    label: 'เลข KEX Lazada ต้องขึ้นต้นด้วย KEXLM, KEXD0LM หรือ KEXDOLM แล้วตามด้วยตัวเลข',
    valid: /^KEX(?:D[0O])?LM\d{8,20}$/i,
  },
  'Lazada Flash': {
    label: 'เลข Lazada Flash ต้องขึ้นต้นด้วย TH',
    valid: /^TH[A-Z0-9]{8,18}$/i,
  },
  'TikTok Flash': {
    label: 'เลข TikTok Flash ต้องขึ้นต้นด้วย THT และเป็นตัวอักษร/ตัวเลข 11-27 ตัว',
    valid: /^THT[A-Z0-9]{8,24}$/i,
  },
  'J&T': {
    label: 'เลข J&T ต้องเป็นตัวเลข 12 หลัก',
    valid: /^[A-Z0-9]{12,18}$/i,
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
const CROSS_DAY_LOOKBACK = 3;

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

export function validateScanCode(courier, value, { allowAnyFormat = false } = {}) {
  const normalizedCode = normalizeScanCode(value);
  const rule = COURIER_RULES[courier];

  if (!normalizedCode) {
    return {
      ok: false,
      code: normalizedCode,
      reason: 'ยังไม่มีเลขสแกน',
    };
  }

  if (allowAnyFormat) {
    return {
      ok: true,
      code: normalizedCode,
      reason: '',
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

export async function apiFetch(url, token, options = {}) {
  const { timeoutMs = GOOGLE_API_TIMEOUT_MS, ...requestOptions } = options;
  const maxRetries = 4;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...requestOptions,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(requestOptions.headers ?? {}),
        },
      });

      if (response.status === 429) {
        // The last 429 used to fall through to the generic !response.ok branch, so the
        // rate-limit message built here was never the one the user saw and the `throw lastError`
        // after the loop was unreachable. Throw the specific error on the final attempt instead.
        if (attempt >= maxRetries) {
          throw Object.assign(
            new Error(`Google จำกัดการเรียกใช้ชั่วคราว (ลองแล้ว ${attempt + 1} ครั้ง) กรุณารอสักครู่แล้วลองใหม่`),
            { status: 429, code: 'GOOGLE_RATE_LIMITED' },
          );
        }
        const retryAfter = response.headers.get('Retry-After');
        const retryAfterSeconds = Number(retryAfter);
        const retryAfterMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? retryAfterSeconds * 1000
          : 0;
        const exponentialMs = Math.min(2000 * (2 ** attempt), 30000);
        const jitterMs = Math.floor(Math.random() * 500);
        await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfterMs, exponentialMs) + jitterMs));
        continue;
      }

      if (!response.ok) {
        // Every catch in App.jsx surfaces error.message straight into the status banner and
        // the camera overlay, and stores it on the order as sheetSyncError. The raw body can
        // carry spreadsheet ids and ranges, so keep it on the error for logs, not in the text.
        const detail = await response.text();
        const error = new Error(`Google ปฏิเสธคำขอ (รหัส ${response.status}) กรุณาลองใหม่ หรือตรวจสอบสิทธิ์เข้าถึง Sheet`);
        error.status = response.status;
        error.detail = detail;
        throw error;
      }

      if (response.status === 204) {
        return null;
      }

      return await response.json();
    } catch (error) {
      if (error?.name === 'AbortError') {
        // `code` is the stable handle for callers and tests; `message` is display text and
        // is expected to change with translation.
        throw Object.assign(
          new Error('Google ตอบสนองช้าเกินกำหนด กรุณาลองอีกครั้ง'),
          { code: 'GOOGLE_TIMEOUT', timeoutMs },
        );
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  // Every iteration returns or throws, and the final one cannot `continue`, so this is only a
  // guard against a future edit turning the loop into a silent `undefined`.
  throw new Error('ลองเชื่อมต่อ Google หลายครั้งแล้วไม่สำเร็จ กรุณาลองใหม่ภายหลัง');
}

async function clearSheetRange({ token, spreadsheetId, range }) {
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`, token, {
    method: 'POST',
    body: '{}',
  });
}

function escapeQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export function escapeSheetName(sheetName) {
  return `'${String(sheetName).replace(/'/g, "''")}'`;
}

export function columnLetter(columnNumber) {
  let number = columnNumber;
  let letters = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    number = Math.floor((number - 1) / 26);
  }
  return letters;
}

function sheetEndColumn() {
  return columnLetter(TOTAL_COLUMNS);
}

function marketplaceItemsText(order) {
  const items = Array.isArray(order?.items)
    ? order.items
    : (Array.isArray(order?.marketplaceItems) ? order.marketplaceItems : []);
  return items
    .map((item) => {
      const name = String(item?.name ?? '').trim();
      const quantity = item?.quantity ? ` x${item.quantity}` : '';
      return `${name}${quantity}`.trim();
    })
    .filter(Boolean)
    .join(' | ');
}

export function marketplaceSkusText(order) {
  const items = Array.isArray(order?.items)
    ? order.items
    : (Array.isArray(order?.marketplaceItems) ? order.marketplaceItems : []);
  const itemSkus = items
    .map((item) => String(item?.sku ?? '').trim())
    .filter(Boolean)
    .join(' | ');
  if (itemSkus) return itemSkus;

  return (Array.isArray(order?.marketplaceSkus) ? order.marketplaceSkus : [])
    .map((sku) => String(sku ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

function marketplaceQtyText(order) {
  const items = Array.isArray(order?.items)
    ? order.items
    : (Array.isArray(order?.marketplaceItems) ? order.marketplaceItems : []);
  const total = items.reduce((sum, item) => sum + (Number(item?.quantity) || 0), 0);
  return total || '';
}

function marketplaceCells(order) {
  return [
    order?.platform ?? '',
    order?.orderId ?? '',
    order?.buyerName ?? '',
    marketplaceItemsText(order),
    marketplaceSkusText(order),
    marketplaceQtyText(order),
    order?.status ?? '',
  ];
}

const PLACEHOLDER_PREFIX = '_TEMP_';

function isPlaceholderNo(value) {
  return String(value ?? '').startsWith(PLACEHOLDER_PREFIX);
}

// A scan writes its row in two steps: a placeholder row (No./Courier No. hold a _TEMP_
// marker used to locate it) and then a corrective update carrying the real numbers. If the
// second step fails the marker is stranded in the sheet forever — the row's data is valid,
// so recovery matches it and certifies the order as synced, leaving nothing to fix it.
// Repair any stranded markers opportunistically whenever a later scan reads the same day.
async function repairPlaceholderRows({ token, spreadsheetId, date, parsedRows, skipPlaceholder = null }) {
  const stranded = parsedRows.filter((row) => (
    isPlaceholderNo(row.no) && String(row.no) !== skipPlaceholder && row.sheetRowNumber
  ));
  if (!stranded.length) return 0;

  const escapedSheet = escapeSheetName(date);
  const data = stranded.map((row) => {
    const overallNo = row.sheetRowNumber - 1;
    const courierRows = parsedRows.filter((candidate) => (
      candidate.courier === row.courier
      && (candidate.sheetRowNumber ?? Infinity) <= row.sheetRowNumber
    ));
    return {
      range: `${escapedSheet}!A${row.sheetRowNumber}:B${row.sheetRowNumber}`,
      values: [[overallNo, courierRows.length]],
    };
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ valueInputOption: 'RAW', data }),
  });
  return stranded.length;
}

function normalizeCrossDayNote(note, { status, scanDate, adminDate }) {
  const noteParts = String(note ?? '')
    .split('|')
    .map((part) => part.trim())
    .filter((part) => part && !/^แพ็คข้ามวัน \(สแกน \d{4}-\d{2}-\d{2}\)$/.test(part));
  const isCrossDaySuccess = status === 'Success'
    && /^\d{4}-\d{2}-\d{2}$/.test(scanDate)
    && /^\d{4}-\d{2}-\d{2}$/.test(adminDate)
    && scanDate > adminDate;

  if (isCrossDaySuccess) noteParts.push(`แพ็คข้ามวัน (สแกน ${scanDate})`);
  return noteParts.join(' | ');
}

function marketplaceOrderFromRow(row) {
  return {
    platform: row.marketplacePlatform ?? '',
    orderId: row.marketplaceOrderId ?? '',
    buyerName: row.buyerName ?? '',
    items: row.marketplaceItems ? [{ name: row.marketplaceItems, sku: row.marketplaceSkus, quantity: row.marketplaceItemQty }] : [],
    status: row.marketplaceStatus ?? '',
  };
}

function withMarketplaceCells(row, marketplaceOrder = null) {
  const baseRow = row.slice(0, SCAN_HEADERS.length + ADMIN_HEADERS.length);
  const source = marketplaceOrder ?? null;
  const status = String(baseRow[8] ?? '').trim();
  const scanDate = String(baseRow[2] ?? '').trim();
  const adminDate = String(baseRow[10] ?? '').trim();
  baseRow[9] = normalizeCrossDayNote(baseRow[9], { status, scanDate, adminDate });
  const hasAdmin = Boolean(String(baseRow[12] ?? '').trim());
  const hasPacker = Boolean(String(baseRow[5] ?? '').trim());
  const adminDateTime = hasAdmin ? parseDateTime(adminDate, String(baseRow[11] ?? '').trim()) : null;
  const isOverdue = hasAdmin && !hasPacker && adminDateTime
    && Date.now() - adminDateTime.getTime() >= 24 * 60 * 60 * 1000;
  const orderStatus = status === 'Success'
    ? 'ส่งออกแล้ว'
    : status === 'Cancelled'
      ? 'ยกเลิก'
      : status === 'Damaged'
        ? 'เสียหาย'
        : hasAdmin && !hasPacker
          ? isOverdue ? 'รอแพ็คเกิน 1 วัน' : 'รอแพ็ค'
          : status || '';
  const crossDay = hasAdmin && hasPacker && scanDate && adminDate && scanDate !== adminDate ? 'ใช่' : 'ไม่ใช่';
  return [...baseRow, ...marketplaceCells(source), orderStatus, crossDay, ''].slice(0, TOTAL_COLUMNS);
}

// Exported for the packing-video sheet, which discovers its own spreadsheet the same way
// prepareGoogleSheets discovers the master one.
export async function findDriveItem({ token, name, mimeType, parentId }) {
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

export async function createDriveItem({ token, name, mimeType, parentId }) {
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
    const preCreateFolder = await findDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
    if (preCreateFolder) {
      folder = preCreateFolder;
    } else {
      try {
        folder = await createDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
      } catch (error) {
        if (String(error).includes('409') || String(error).includes('already exists')) {
          folder = await findDriveItem({ token, name: FOLDER_NAME, mimeType: MIME_FOLDER });
        }
        if (!folder) {
          throw error;
        }
      }
    }
  }

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

export async function getSpreadsheet(token, spreadsheetId) {
  return apiFetch(
    `${SHEETS_API}/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`,
    token,
  );
}

async function getSheetConditionalFormats({ token, spreadsheetId, date, sheetId }) {
  const range = `${escapeSheetName(date)}!A1`;
  const fields = 'sheets(properties(sheetId),conditionalFormats(ranges,booleanRule))';
  const spreadsheet = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}?ranges=${encodeURIComponent(range)}&fields=${encodeURIComponent(fields)}`,
    token,
  );
  return spreadsheet.sheets?.find((sheet) => sheet.properties?.sheetId === sheetId)
    ?.conditionalFormats ?? [];
}

/**
 * Deletes the legacy management tabs.
 *
 * Dashboard / Audit Log / All Orders were dropped: everything they showed is in the app, and
 * rebuilding them cost a read per date tab plus a dozen writes on every sign-in. The builder
 * that used to live here sat behind an unconditional `return` for long enough that it had
 * drifted out of step with the live row layout, so it is gone rather than dormant.
 */
const LEGACY_MANAGEMENT_SHEETS = ['Dashboard', 'Audit Log', 'All Orders'];

async function ensureManagementSheets({ token, spreadsheetId }) {
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const removedManagementSheets = (spreadsheet.sheets ?? [])
    .filter((sheet) => LEGACY_MANAGEMENT_SHEETS.includes(sheet.properties.title))
    .map((sheet) => ({ deleteSheet: { sheetId: sheet.properties.sheetId } }));
  if (removedManagementSheets.length === 0) return;

  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ requests: removedManagementSheets }),
  });
}

export async function ensureGoogleSheetOrganization({ token, config }) {
  if (config?.master?.id) await ensureManagementSheets({ token, spreadsheetId: config.master.id });
}

async function ensureDailyWorksheet({ token, spreadsheetId, date }) {
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
      'Sheet1',
      'ชีต1',
      'シート1',
      '시트1',
      '工作表1',
      'Feuille 1',
      'Tabelle1',
      'Hoja 1',
      'Página1',
      'Foglio1',
      'Лист1',
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
                    columnCount: TOTAL_COLUMNS,
                  },
                },
                fields: 'title,index,gridProperties(rowCount,columnCount)',
              },
            },
          ],
        }),
      });
    } catch (error) {
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
                  columnCount: TOTAL_COLUMNS,
                },
              },
            },
          },
        ],
      }),
    });
  } catch (error) {
    if (!String(error).includes('already exists') && !String(error).includes('duplicate')) {
      throw error;
    }
  }

  const postCreateSpreadsheet = await getSpreadsheet(token, spreadsheetId);
  const worksheet = postCreateSpreadsheet.sheets.find((sheet) => sheet.properties.title === date)?.properties;
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
  await formatDailyWorksheet({ token, spreadsheetId, date, sheetId });
  formattedWorksheetKeys.add(key);
}

async function writeHeaders({ token, spreadsheetId, date }) {
  await apiFetch(
    // Quoted like every other range in this file: a bare sheet name is the one thing A1
    // notation will not reliably accept, and _conflict tabs are not plain dates.
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${escapeSheetName(date)}!A1:${sheetEndColumn()}1`)}?valueInputOption=RAW`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({
        values: [ALL_HEADERS],
      }),
    },
  );
}

async function formatDailyWorksheet({ token, spreadsheetId, date, sheetId }) {
  const existingConditionalFormats = await getSheetConditionalFormats({
    token,
    spreadsheetId,
    date,
    sheetId,
  });
  const managedConditionalFormats = [
    ...buildStatusFormattingRequests(sheetId),
    ...buildMarketplaceFormattingRequests(sheetId),
  ];
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
                columnCount: TOTAL_COLUMNS,
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
                endColumnIndex: TOTAL_COLUMNS,
              },
            },
          },
        },
        ...buildDailyDataTypeFormattingRequests(sheetId),
        ...buildConditionalFormatReconciliationRequests({
          sheetId,
          existingRules: existingConditionalFormats,
          managedRequests: managedConditionalFormats,
        }),
        buildStatusValidationRequest(sheetId),
      ],
    }),
  });
  await applyStatusCellColors({ token, spreadsheetId, date, sheetId });
}

export function buildDailyDataTypeFormattingRequests(sheetId) {
  const formats = [
    { columnIndex: 2, numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } },
    { columnIndex: 3, numberFormat: { type: 'TIME', pattern: 'h:mm:ss' } },
    { columnIndex: 5, numberFormat: { type: 'TEXT', pattern: '@' } },
    { columnIndex: 10, numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } },
    { columnIndex: 11, numberFormat: { type: 'TIME', pattern: 'h:mm:ss' } },
    { columnIndex: 12, numberFormat: { type: 'TEXT', pattern: '@' } },
  ];

  return formats.map(({ columnIndex, numberFormat }) => ({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: columnIndex,
        endColumnIndex: columnIndex + 1,
      },
      cell: { userEnteredFormat: { numberFormat } },
      fields: 'userEnteredFormat.numberFormat',
    },
  }));
}

/**
 * Recolours the status columns.
 *
 * `rowNumbers` narrows it to the rows a write actually touched. Without it every single scan
 * re-read the whole day and sent up to ~1,500 repeatCell requests to repaint rows whose colour
 * had not changed — on top of the ~12 Google calls a scan already makes, against a sheet lock
 * with a limited TTL. Passing nothing still repaints the whole day, which is what the
 * historical-recolour pass wants.
 */
async function applyStatusCellColors({ token, spreadsheetId, date, sheetId, rowNumbers = null }) {
  const only = rowNumbers ? new Set(rowNumbers) : null;
  const rows = await readDailyRows({ token, spreadsheetId, date });
  const requests = [];
  const colors = {
    success: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.88 }, foregroundColor: { red: 0.1, green: 0.45, blue: 0.2 } },
    pending: { backgroundColor: { red: 1, green: 0.95, blue: 0.75 }, foregroundColor: { red: 0.55, green: 0.35, blue: 0 } },
    overdue: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 }, foregroundColor: { red: 0.65, green: 0.05, blue: 0.05 } },
    cancelled: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 }, foregroundColor: { red: 0.65, green: 0.05, blue: 0.05 } },
    crossDay: { backgroundColor: { red: 1, green: 0.9, blue: 0.75 }, foregroundColor: { red: 0.65, green: 0.35, blue: 0 } },
  };
  // The 500 cap bounds a full repaint. A targeted repaint must not be capped, or a row past
  // the cap would silently keep the colour of whatever it used to be.
  (only ? rows : rows.slice(0, 500)).forEach((row, index) => {
    // index 0 is sheet row 2, the first data row.
    if (only && !only.has(index + 2)) return;
    const status = String(row[8] ?? '').trim();
    const hasPacker = Boolean(String(row[5] ?? '').trim());
    const hasAdmin = Boolean(String(row[12] ?? '').trim());
    const scanDate = String(row[2] ?? '').trim();
    const adminDate = String(row[10] ?? '').trim();
    const adminAt = hasAdmin ? parseDateTime(adminDate, String(row[11] ?? '').trim()) : null;
    const overdue = hasAdmin && !hasPacker && adminAt
      && Date.now() - adminAt.getTime() >= 24 * 60 * 60 * 1000;
    const style = status === 'Cancelled'
      ? colors.cancelled
      : status === 'Success'
      ? colors.success
      : hasAdmin && !hasPacker
        ? overdue ? colors.overdue : colors.pending
        : null;
    const rowStart = index + 1;
    if (style) requests.push({ repeatCell: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 8, endColumnIndex: 9 }, cell: { userEnteredFormat: { backgroundColor: style.backgroundColor, textFormat: { foregroundColor: style.foregroundColor, bold: status !== 'Success' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
    if (style) requests.push({ repeatCell: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 20, endColumnIndex: 21 }, cell: { userEnteredFormat: { backgroundColor: style.backgroundColor, textFormat: { foregroundColor: style.foregroundColor, bold: status !== 'Success' } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
    if (hasAdmin && hasPacker && scanDate && adminDate && scanDate !== adminDate) requests.push({ repeatCell: { range: { sheetId, startRowIndex: rowStart, endRowIndex: rowStart + 1, startColumnIndex: 21, endColumnIndex: 22 }, cell: { userEnteredFormat: { backgroundColor: colors.crossDay.backgroundColor, textFormat: { foregroundColor: colors.crossDay.foregroundColor, bold: true } } }, fields: 'userEnteredFormat(backgroundColor,textFormat)' } });
  });
  if (requests.length > 0) await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests }) });
}

function buildStatusFormattingRequests(sheetId) {
  const statusRange = { sheetId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 };
  const orderStatusRange = { sheetId, startRowIndex: 1, startColumnIndex: 20, endColumnIndex: 21 };
  const crossDayRange = { sheetId, startRowIndex: 1, startColumnIndex: 21, endColumnIndex: 22 };
  const rule = (range, formula, backgroundColor, foregroundColor, bold = false) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [range],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] },
          format: { backgroundColor, textFormat: { foregroundColor, bold } },
        },
      },
      index: 0,
    },
  });
  return [
    rule(statusRange, '=$I2="Success"', { red: 0.85, green: 0.95, blue: 0.88 }, { red: 0.1, green: 0.45, blue: 0.2 }),
    rule(statusRange, '=$I2="Cancelled"', { red: 0.98, green: 0.82, blue: 0.82 }, { red: 0.65, green: 0.05, blue: 0.05 }, true),
    rule(orderStatusRange, '=$U2="ยกเลิก"', { red: 0.98, green: 0.82, blue: 0.82 }, { red: 0.65, green: 0.05, blue: 0.05 }, true),
    rule(orderStatusRange, '=$U2="ส่งออกแล้ว"', { red: 0.85, green: 0.95, blue: 0.88 }, { red: 0.1, green: 0.45, blue: 0.2 }),
    rule(orderStatusRange, '=$U2="รอแพ็ค"', { red: 1, green: 0.95, blue: 0.75 }, { red: 0.55, green: 0.35, blue: 0 }),
    rule(orderStatusRange, '=$U2="รอแพ็คเกิน 1 วัน"', { red: 0.98, green: 0.82, blue: 0.82 }, { red: 0.65, green: 0.05, blue: 0.05 }, true),
    rule(crossDayRange, '=$V2="ใช่"', { red: 1, green: 0.9, blue: 0.75 }, { red: 0.65, green: 0.35, blue: 0 }),
  ];
}

function conditionalFormatRuleKey(rule) {
  if (rule?.ranges?.length !== 1 || rule.booleanRule?.condition?.type !== 'CUSTOM_FORMULA') {
    return '';
  }
  const range = rule.ranges[0];
  const formula = rule.booleanRule.condition.values?.[0]?.userEnteredValue;
  if (!formula) return '';
  return [
    range.sheetId,
    range.startRowIndex ?? 0,
    range.startColumnIndex ?? 0,
    range.endColumnIndex ?? '',
    formula,
  ].join('|');
}

/**
 * Replaces only the conditional-format rules owned by this app. Google normalizes colours
 * and fills in omitted row bounds when a rule is saved, so matching the complete API object
 * would miss the same logical rule and let another copy accumulate on every new session.
 */
export function buildConditionalFormatReconciliationRequests({
  sheetId,
  existingRules = [],
  managedRequests = [],
}) {
  const managedKeys = new Set(managedRequests
    .map((request) => request.addConditionalFormatRule?.rule)
    .map(conditionalFormatRuleKey)
    .filter(Boolean));
  const deleteRequests = existingRules
    .map((rule, index) => ({ index, key: conditionalFormatRuleKey(rule) }))
    .filter(({ key }) => managedKeys.has(key))
    .sort((left, right) => right.index - left.index)
    .map(({ index }) => ({ deleteConditionalFormatRule: { sheetId, index } }));
  return [...deleteRequests, ...managedRequests];
}

export function buildStatusValidationRequest(sheetId) {
  // Barcode scanners behave like keyboards. A strict list prevents an accidental scanner
  // focus in Google Sheets from replacing Status with a tracking number; every value the
  // app writes is deliberately listed here.
  return {
    setDataValidation: {
      range: {
        sheetId,
        startRowIndex: 1,
        endRowIndex: 5000,
        startColumnIndex: 8,
        endColumnIndex: 9,
      },
      rule: {
        condition: {
          type: 'ONE_OF_LIST',
          values: ['Success', 'Cancelled', 'Returned', 'Damaged', 'Issue', 'Duplicate', 'รอแพ็ค']
            .map((userEnteredValue) => ({ userEnteredValue })),
        },
        strict: true,
        showCustomUi: true,
      },
    },
  };
}

export function buildMarketplaceFormattingRequests(sheetId) {
  const marketplaceRange = {
    sheetId,
    startRowIndex: 1,
    startColumnIndex: 13,
    endColumnIndex: 14,
  };
  const rule = (formula, backgroundColor) => ({
    addConditionalFormatRule: {
      rule: {
        ranges: [marketplaceRange],
        booleanRule: {
          condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: formula }] },
          format: {
            backgroundColor,
            textFormat: {
              foregroundColor: { red: 1, green: 1, blue: 1 },
              bold: true,
            },
          },
        },
      },
      index: 0,
    },
  });

  return [
    rule('=REGEXMATCH(LOWER(TRIM($N2)),"^shopee")', { red: 0.933, green: 0.302, blue: 0.176 }),
    rule('=REGEXMATCH(LOWER(TRIM($N2)),"^(lazada|kex lazada)")', { red: 0.102, green: 0.451, blue: 0.910 }),
    rule('=REGEXMATCH(LOWER(TRIM($N2)),"^tiktok")', { red: 0, green: 0, blue: 0 }),
  ];
}

export function getDailySheetPropertiesForMarketplaceBackfill(sheetProperties) {
  return (sheetProperties ?? []).filter((properties) => (
    /^\d{4}-\d{2}-\d{2}(?:_conflict\d+)?$/.test(properties.title)
  ));
}

async function applyMarketplaceFormatting({
  token,
  spreadsheetId,
  sheetId,
  existingRules = [],
}) {
  const requests = buildConditionalFormatReconciliationRequests({
    sheetId,
    existingRules,
    managedRequests: buildMarketplaceFormattingRequests(sheetId),
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
    method: 'POST',
    body: JSON.stringify({ requests }),
  });
}

async function readDailyRows({ token, spreadsheetId, date }) {
  const range = `${escapeSheetName(date)}!A2:${sheetEndColumn()}`;
  const params = new URLSearchParams({
    majorDimension: 'ROWS',
  });
  const data = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?${params}`,
    token,
  );
  return data.values ?? [];
}

async function readDailyRow({ token, spreadsheetId, date, rowNumber }) {
  const range = `${escapeSheetName(date)}!A${rowNumber}:${sheetEndColumn()}${rowNumber}`;
  const data = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(range)}?majorDimension=ROWS`,
    token,
  );
  return rowFromSheet(data.values?.[0] ?? [], rowNumber - 2);
}

async function batchReadDailyRows({ token, spreadsheetId, sheetNames }) {
  const rowsBySheet = new Map();
  const chunkSize = 50;

  for (let index = 0; index < sheetNames.length; index += chunkSize) {
    const chunk = sheetNames.slice(index, index + chunkSize);
    const params = new URLSearchParams({ majorDimension: 'ROWS' });
    chunk.forEach((sheetName) => {
      params.append('ranges', `${escapeSheetName(sheetName)}!A2:${sheetEndColumn()}`);
    });
    const data = await apiFetch(
      `${SHEETS_API}/${spreadsheetId}/values:batchGet?${params}`,
      token,
    );
    chunk.forEach((sheetName, chunkIndex) => {
      rowsBySheet.set(sheetName, data.valueRanges?.[chunkIndex]?.values ?? []);
    });
  }

  return rowsBySheet;
}

const GOOGLE_SHEETS_EPOCH_UTC = Date.UTC(1899, 11, 30);
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function googleSheetsDateSerial(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) return null;

  return (timestamp - GOOGLE_SHEETS_EPOCH_UTC) / MILLISECONDS_PER_DAY;
}

function googleSheetsTimeSerial(value) {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, hourText, minuteText, secondText] = match;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return ((hour * 60 * 60) + (minute * 60) + second) / (24 * 60 * 60);
}

function normalizeDailyRawCells(row) {
  const normalizedRow = [...row];

  // The Values API returns formatted cells as strings. Restore the native types
  // before RAW merge/recovery writes so Sheets keeps its normal alignment and formats.
  for (const columnIndex of [0, 1]) {
    const value = normalizedRow[columnIndex];
    if (typeof value !== 'string') continue;

    const trimmedValue = value.trim();
    if (!/^[1-9]\d*$/.test(trimmedValue)) continue;

    const numericValue = Number(trimmedValue);
    if (Number.isSafeInteger(numericValue)) normalizedRow[columnIndex] = numericValue;
  }

  for (const columnIndex of [2, 10]) {
    const serial = googleSheetsDateSerial(normalizedRow[columnIndex]);
    if (serial !== null) normalizedRow[columnIndex] = serial;
  }

  for (const columnIndex of [3, 11]) {
    const serial = googleSheetsTimeSerial(normalizedRow[columnIndex]);
    if (serial !== null) normalizedRow[columnIndex] = serial;
  }

  for (const columnIndex of [5, 12]) {
    const value = normalizedRow[columnIndex];
    if (typeof value === 'number' && Number.isSafeInteger(value)) {
      normalizedRow[columnIndex] = String(value);
    }
  }

  return normalizedRow;
}

export function buildDailyRowUpdateData(date, rowNumber, row) {
  const sheetName = escapeSheetName(date);
  const normalizedRow = normalizeDailyRawCells(row);
  return [
    {
      range: `${sheetName}!A${rowNumber}:O${rowNumber}`,
      values: [normalizedRow.slice(0, 15)],
    },
    {
      range: `${sheetName}!Q${rowNumber}:${sheetEndColumn()}${rowNumber}`,
      values: [normalizedRow.slice(16, TOTAL_COLUMNS)],
    },
  ];
}

async function updateDailyRow({ token, spreadsheetId, date, rowNumber, row }) {
  // Buyer Name (P) is edited manually in Sheets. Never include it in a
  // scan-driven row update, otherwise an empty marketplace payload erases it.
  const data = buildDailyRowUpdateData(date, rowNumber, row);
  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values:batchUpdate`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data,
      }),
    },
  );
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const sheetId = spreadsheet.sheets?.find((sheet) => sheet.properties.title === date)?.properties.sheetId;
  if (sheetId) await applyStatusCellColors({ token, spreadsheetId, date, sheetId, rowNumbers: [rowNumber] });
  return readDailyRow({ token, spreadsheetId, date, rowNumber });
}

export async function backfillMarketplaceOrdersGoogle({ token, config, groups }) {
  const spreadsheetId = config?.master?.id;
  if (!spreadsheetId) throw new Error('ไม่พบ Google Sheet Master');
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const dateSheets = (spreadsheet.sheets ?? [])
    .map((item) => item.properties.title)
    .filter((title) => /^\d{4}-\d{2}-\d{2}(?:_conflict\d+)?$/.test(title));
  const rowsBySheet = await batchReadDailyRows({ token, spreadsheetId, sheetNames: dateSheets });
  const updates = [];
  let matchedRows = 0;
  let updatedSheets = 0;
  for (const sheetName of dateSheets) {
    const rows = rowsBySheet.get(sheetName) ?? [];
    const result = buildSheetBackfillUpdates(sheetName, rows, groups);
    if (result.matchedRows > 0) updatedSheets += 1;
    matchedRows += result.matchedRows;
    updates.push(...result.data);
  }
  for (let index = 0; index < updates.length; index += 400) {
    await apiFetch(`${SHEETS_API}/${spreadsheetId}/values:batchUpdate`, token, {
      method: 'POST',
      body: JSON.stringify({ valueInputOption: 'RAW', data: updates.slice(index, index + 400) }),
    });
  }
  return { matchedRows, updatedCells: updates.length, updatedSheets };
}

export async function syncLateOrdersGoogle({ token, config, orders, now = new Date() }) {
  const spreadsheetId = config?.master?.id;
  if (!spreadsheetId) throw new Error('ไม่พบ Google Sheet Master');
  const title = 'Late Orders';
  let spreadsheet = await getSpreadsheet(token, spreadsheetId);
  let properties = spreadsheet.sheets?.find((sheet) => sheet.properties.title === title)?.properties;
  if (!properties) {
    await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: {
        properties: { title, index: 0, gridProperties: { rowCount: Math.max(100, orders.length + 10), columnCount: 9 } },
      } }] }),
    });
    spreadsheet = await getSpreadsheet(token, spreadsheetId);
    properties = spreadsheet.sheets?.find((sheet) => sheet.properties.title === title)?.properties;
  }
  if (!properties) throw new Error('สร้างชีต Late Orders ไม่สำเร็จ');

  const classified = orders.map((order) => ({ order, status: classifyLateOrder(order, now) }));
  const updatedAt = getBangkokParts(now);
  const values = [[
    'Platform', 'Order ID', 'Tracking', 'SKUs', 'Expected Ship',
    'Seller Status', 'Scan Status', 'Alert', 'Updated At',
  ], ...classified.map(({ order, status }) => [
    order.platform, order.orderId, order.trackingNo, order.marketplaceSkus.join(' | '),
    order.expectedShipAt || '', order.sellerOrderStatus || '',
    order.scanned ? 'สแกนแล้ว' : 'ยังไม่สแกน', status.label,
    `${updatedAt.date} ${updatedAt.time}`,
  ])];

  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1:I`)}:clear`,
    token,
    { method: 'POST', body: '{}' },
  );
  await apiFetch(
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${title}!A1:I${values.length}`)}?valueInputOption=RAW`,
    token,
    { method: 'PUT', body: JSON.stringify({ values }) },
  );

  const color = {
    green: { red: 0.80, green: 0.94, blue: 0.82 },
    red: { red: 0.96, green: 0.78, blue: 0.76 },
    orange: { red: 1, green: 0.90, blue: 0.68 },
  };
  const requests = [
    { updateSheetProperties: {
      properties: { sheetId: properties.sheetId, gridProperties: {
        frozenRowCount: 1, rowCount: Math.max(properties.gridProperties?.rowCount ?? 100, values.length + 10), columnCount: 9,
      } },
      fields: 'gridProperties(frozenRowCount,rowCount,columnCount)',
    } },
    { repeatCell: {
      range: { sheetId: properties.sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: { red: 0.18, green: 0.35, blue: 0.55 }, textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } } } },
      fields: 'userEnteredFormat(backgroundColor,textFormat)',
    } },
    { repeatCell: {
      range: { sheetId: properties.sheetId, startRowIndex: 1, endRowIndex: Math.max(2, values.length), startColumnIndex: 0, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 } } },
      fields: 'userEnteredFormat.backgroundColor',
    } },
    { setBasicFilter: { filter: { range: {
      sheetId: properties.sheetId, startRowIndex: 0, endRowIndex: Math.max(2, values.length), startColumnIndex: 0, endColumnIndex: 9,
    } } } },
    { autoResizeDimensions: { dimensions: { sheetId: properties.sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 9 } } },
  ];
  classified.forEach(({ status }, index) => {
    if (!color[status.color]) return;
    requests.push({ repeatCell: {
      range: { sheetId: properties.sheetId, startRowIndex: index + 1, endRowIndex: index + 2, startColumnIndex: 0, endColumnIndex: 9 },
      cell: { userEnteredFormat: { backgroundColor: color[status.color] } },
      fields: 'userEnteredFormat.backgroundColor',
    } });
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
    method: 'POST', body: JSON.stringify({ requests }),
  });

  const counts = classified.reduce((result, item) => {
    result[item.status.key] = (result[item.status.key] ?? 0) + 1;
    return result;
  }, {});
  return { rows: classified.length, counts };
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

export async function colorAllHistoricalSheetsGoogle({ token, config }) {
  const spreadsheetId = config?.master?.id;
  if (!spreadsheetId) return { colored: 0, total: 0 };
  const spreadsheet = await apiFetch(
    `${SHEETS_API}/${spreadsheetId}?fields=${encodeURIComponent('sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)),conditionalFormats(ranges,booleanRule))')}`,
    token,
  );
  const conditionalFormatsBySheetId = new Map((spreadsheet.sheets ?? []).map((sheet) => [
    sheet.properties.sheetId,
    sheet.conditionalFormats ?? [],
  ]));
  const dateSheets = getDailySheetPropertiesForMarketplaceBackfill(
    (spreadsheet.sheets ?? []).map((item) => item.properties),
  );
  let colored = 0;
  for (const sheet of dateSheets) {
    if ((sheet.gridProperties?.columnCount ?? 0) < TOTAL_COLUMNS) {
      await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, {
        method: 'POST',
        body: JSON.stringify({ requests: [{ updateSheetProperties: {
          properties: { sheetId: sheet.sheetId, gridProperties: { columnCount: TOTAL_COLUMNS } },
          fields: 'gridProperties.columnCount',
        } }] }),
      });
    }
    await applyMarketplaceFormatting({
      token,
      spreadsheetId,
      sheetId: sheet.sheetId,
      existingRules: conditionalFormatsBySheetId.get(sheet.sheetId) ?? [],
    });
    await applyStatusCellColors({ token, spreadsheetId, date: sheet.title, sheetId: sheet.sheetId });
    colored += 1;
  }
  return { colored, total: dateSheets.length };
}

export async function getDriveRowsGoogle({ token, config, date = getBangkokParts().date }) {
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
  return rows.map(rowFromSheet).filter((row) => row.adminCode && row.adminCode.trim() !== '').reverse();
}

export async function fetchTodayPackerCounts({ token, config }) {
  const data = await fetchTodaySummary({ token, config });
  return data?.packerCounts ?? [];
}

export async function fetchTodaySummary({ token, config, couriers = COURIERS }) {
  const sheet = config?.master;
  if (!sheet?.id) {
    return null;
  }

  const date = getBangkokParts().date;
  await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });

  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const sheetDates = (spreadsheet.sheets ?? [])
    .map((item) => item.properties.title)
    .filter((title) => /^\d{4}-\d{2}-\d{2}$/.test(title));
  // Every tab is read because a cross-day merge leaves a row whose event date differs from
  // the tab holding it. Read them 50 tabs per request: the previous Promise.all fired one
  // request per tab all at once, so a year of tabs meant ~365 concurrent calls and the
  // Sheets per-minute quota answered with 429s on the Packer home screen.
  const rowsBySheet = await batchReadDailyRows({ token, spreadsheetId: sheet.id, sheetNames: sheetDates });
  const parsedRows = sheetDates.flatMap((sheetDate) => (
    (rowsBySheet.get(sheetDate) ?? []).map(rowFromSheet)
  ));
  const shippedRows = parsedRows.filter((row) => row.status === 'Success' && row.date === date);

  const courierCounts = couriers.map((courier) => ({
    courier,
    count: shippedRows.filter((r) => r.courier === courier).length,
  }));

  const packerMap = new Map();
  for (const row of shippedRows) {
    const packer = String(row.packer ?? '').trim();
    const status = String(row.status ?? '').trim();
    if (status === 'Success' && packer) {
      packerMap.set(packer, (packerMap.get(packer) ?? 0) + 1);
    }
  }
  const packerCounts = [...packerMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([packer, count]) => ({ packer, count }));

  return { courierCounts, packerCounts };
}

export async function getScanReportGoogle({ token, config, dates, couriers = COURIERS }) {
  const uniqueDates = [...new Set(dates)].filter(Boolean).sort();
  const dayMap = new Map(
    uniqueDates.map((date) => [
      date,
      {
        date,
        total: 0,
        cancelledTotal: 0,
        returnedTotal: 0,
        damagedTotal: 0,
        couriers: couriers.map((courier) => ({ courier, count: 0 })),
      },
    ]),
  );
  const courierTotals = couriers.map((courier) => ({ courier, count: 0 }));
  const cancelledRows = [];
  const returnedRows = [];
  const damagedRows = [];
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const sheetTitles = (spreadsheet.sheets ?? [])
    .map((item) => item.properties.title)
    .filter((title) => /^\d{4}-\d{2}-\d{2}$/.test(title));

  // Every tab is scanned because a cross-day merge leaves a row whose event date differs
  // from the tab holding it. Read them 50 tabs per request instead of one request per tab:
  // a single-day report over a year of tabs was ~365 serial calls, each with a 25s timeout.
  const rowsBySheet = await batchReadDailyRows({ token, spreadsheetId: sheet.id, sheetNames: sheetTitles });

  for (const sheetDate of sheetTitles) {
    const rows = (rowsBySheet.get(sheetDate) ?? []).map(rowFromSheet);
    for (const row of rows) {
      const eventDate = row.status === 'Success' && row.code ? row.date : row.adminDate || row.date;
      const day = dayMap.get(eventDate);
      if (!day) continue;
      const isCancelled = row.status === 'Cancelled' || row.note === 'ลูกค้ายกเลิก';
      if (isCancelled) {
        day.cancelledTotal += 1;
        cancelledRows.push(row);
        continue;
      }

      const isReturned = row.status === 'Returned' || row.note === 'สินค้าตีกลับ';
      if (isReturned) {
        day.returnedTotal += 1;
        returnedRows.push(row);
        continue;
      }

      const isDamaged = row.status === 'Damaged' || row.note === 'สินค้าเสียหาย';
      if (isDamaged) {
        day.damagedTotal += 1;
        damagedRows.push(row);
        continue;
      }

      // Only count Success rows in courier totals — admin-only rows (รอแพ็ค etc.)
      // should not be counted as shipped items
      if (row.status !== 'Success') {
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
    returnedTotal: returnedRows.length,
    returnedRows: returnedRows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)),
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
      const adminCode = normalizeScanCode(item.adminCode);
      if (courierSet.has(item.courier) && (code.includes(normalizedQuery) || adminCode.includes(normalizedQuery))) {
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

export async function getRowsForFirestoreBackfillGoogle({ token, config, dates }) {
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const sheetTitles = new Set(spreadsheet.sheets?.map((item) => item.properties.title) ?? []);
  const backfillDates = [...new Set(dates)].filter(Boolean).sort()
    .filter((date) => sheetTitles.has(date));
  // 50 tabs per request instead of one awaited request per tab: a monthly backfill was 31
  // serial round trips, each carrying its own 25s timeout before the next one could start.
  const rowsBySheet = await batchReadDailyRows({ token, spreadsheetId: sheet.id, sheetNames: backfillDates });
  const rows = [];

  for (const date of backfillDates) {
    rows.push(
      ...(rowsBySheet.get(date) ?? [])
        .map((row, index) => rowFromSheet(row, index))
        .filter((row) => row.code || row.adminCode)
        .map((row) => ({
          ...row,
          date: row.date || row.adminDate || date,
          _sheetDate: date,
          sheetUrl: sheet.webViewLink,
        })),
    );
  }

  return rows;
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

/**
 * appendScanGoogle
 * Packer scan — unchanged basic flow, with one addition:
 * If the tracking code already exists in the admin columns (K-M),
 * merge the packer data into that existing row instead of rejecting as duplicate.
 */
export async function appendScanGoogle({
  token,
  config,
  courier,
  code,
  email,
  packer = '',
  note = '',
  marketplaceOrder = null,
  scanDate = null,
  scanTime = null,
  adminDate = null,
  adminTime = null,
  adminCode = null,
}) {
  const normalizedCode = normalizeScanCode(code);
  const issueMeta = getScanIssueMeta(note);
  const isIssueScan = issueMeta.isIssue;
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const nowParts = getBangkokParts();
  const date = scanDate || nowParts.date;
  const time = scanTime || nowParts.time;
  const effectiveAdminDate = adminDate || '';
  const effectiveAdminTime = adminTime || '';
  const effectiveAdminCode = normalizeScanCode(adminCode || '');
  await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });
  const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const parsedRows = rows.map(rowFromSheet);
  const crossDayCache = createCrossDayCache();
  const courierRows = parsedRows.filter((row) => row.courier === courier);
  const reconciliation = findScanReconciliation(parsedRows, {
    courier,
    code: normalizedCode,
    isPacker: true,
    packerName: packer,
  });
  const duplicateRow = reconciliation.action === 'skip' ? reconciliation.row : null;
  const duplicate = Boolean(duplicateRow);

  // A cancellation can be scanned after the original packer row's day has
  // rolled over. Find and update that historical row before appending today.
  if (!duplicate && isIssueScan) {
    const crossDayMatch = await findRowsAcrossDays({
      token,
      spreadsheetId: sheet.id,
      currentDate: date,
      courier,
      code: normalizedCode,
      matcher: (candidateRows) => findHistoricalIssueRow(candidateRows, { courier, code: normalizedCode }),
      cache: crossDayCache,
    });

    if (crossDayMatch) {
      const currentRow = crossDayMatch.row;
      const updatedRow = withMarketplaceCells([
        currentRow.no,
        currentRow.courierNo,
        currentRow.date,
        currentRow.time,
        currentRow.courier,
        currentRow.code,
        currentRow.email,
        currentRow.packer,
        issueMeta.sheetStatus,
        note,
        currentRow.adminDate || '',
        currentRow.adminTime || '',
        currentRow.adminCode || '',
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

      const confirmedRow = await updateDailyRow({
        token,
        spreadsheetId: sheet.id,
        date: crossDayMatch.date,
        rowNumber: currentRow.sheetRowNumber,
        row: updatedRow,
      });

      const nextRows = crossDayMatch.parsedRows
        .map((row) => row.sheetRowNumber === currentRow.sheetRowNumber ? rowFromSheet(updatedRow) : row)
        .filter((row) => row.courier === currentRow.courier)
        .reverse();

      return {
        status: issueMeta.resultStatus,
        courier: currentRow.courier,
        date,
        time,
        code: normalizedCode,
        row: confirmedRow,
        count: crossDayMatch.parsedRows.filter((row) => row.courier === courier).length,
        rows: nextRows,
        sheetUrl: sheet.webViewLink,
        crossDay: true,
        updatedDate: crossDayMatch.date,
      };
    }
  }

  // If packer scans a code that admin already put in column M, merge into that row
  if (!duplicate && !isIssueScan) {
    const adminMatchRow = reconciliation.action === 'merge-packer' ? reconciliation.row : null;
    if (adminMatchRow) {
      // Re-read to get fresh row position
      const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
      const verifyParsed = verifyRows.map(rowFromSheet);
      const targetIdx = verifyParsed.findIndex(
        (row) => normalizeScanCode(row.adminCode) === normalizeScanCode(normalizedCode),
      );
      if (targetIdx === -1) {
        // Row was deleted, fall through to normal append
      } else {
        const currentRow = verifyParsed[targetIdx];
        const targetRowNumber = targetIdx + 2;
        // Calculate Courier No. for this courier's existing rows + 1
        const existingCourierRows = verifyParsed.filter(
          (r) => r.courier === currentRow.courier && r.code && r.code.trim() !== '',
        );
        const courierNo = existingCourierRows.length + 1;
        const overallNo = targetIdx + 1;

        const mergedRow = withMarketplaceCells([
          overallNo,
          courierNo,
          date,
          time,
          currentRow.courier,
          normalizedCode,
          email,
          packer,
          'Success',
          note,
          currentRow.adminDate || effectiveAdminDate || date,
          currentRow.adminTime || effectiveAdminTime || time,
          currentRow.adminCode || effectiveAdminCode,
        ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

        const confirmedRow = await updateDailyRow({
          token,
          spreadsheetId: sheet.id,
          date,
          rowNumber: targetRowNumber,
          row: mergedRow,
        });

        const resultRows = verifyParsed
          .map((row) =>
            row.sheetRowNumber === targetRowNumber ? rowFromSheet(mergedRow) : row,
          )
          .filter((row) => row.courier === currentRow.courier)
          .reverse()
          .slice(0, 20);

        return {
          status: 'success',
          courier: currentRow.courier,
          selectedCourier: courier,
          date,
          time,
          code: normalizedCode,
          count: courierNo,
          row: confirmedRow,
          rows: resultRows,
          sheetUrl: sheet.webViewLink,
          merged: true,
        };
      }
    }

    const crossDayMatch = await findRowsAcrossDays({ token, spreadsheetId: sheet.id, currentDate: date, code: normalizedCode, field: 'adminCode', cache: crossDayCache });
    if (crossDayMatch) {
      const currentRow = crossDayMatch.row;
      // Column C must name the sheet the row actually lives on: rowFromSheet reads
      // row.date from it and updateScanIssueGoogle uses that to pick which sheet to
      // search. Writing today's date onto a row kept on the admin's earlier sheet made
      // every later issue update on it fail with "ไม่พบรายการใน Google Sheet".
      const mergedRow = withMarketplaceCells([
        currentRow.no, currentRow.courierNo, crossDayMatch.date, time, currentRow.courier, normalizedCode, email, packer,
        'Success', note, currentRow.adminDate || effectiveAdminDate || crossDayMatch.date, currentRow.adminTime || effectiveAdminTime || '', currentRow.adminCode || effectiveAdminCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
      // `row` is the written-back row, not the pre-merge one: isSheetSyncResultConfirmed needs
      // it to certify the write, and this was the one merge path that dropped it. Without it
      // every cross-day Packer scan reported "Sheet ยังไม่สำเร็จ" and re-queued an order that
      // had in fact been merged correctly.
      const confirmedRow = await updateDailyRow({ token, spreadsheetId: sheet.id, date: crossDayMatch.date, rowNumber: currentRow.sheetRowNumber, row: mergedRow });
      const resultRows = crossDayMatch.parsedRows
        .map((row) => row.sheetRowNumber === currentRow.sheetRowNumber ? rowFromSheet(mergedRow) : row)
        .filter((row) => row.courier === currentRow.courier)
        .reverse()
        .slice(0, 20);
      return { status: 'success', courier: currentRow.courier, selectedCourier: courier, date, time, code: normalizedCode, row: confirmedRow, rows: resultRows, sheetUrl: sheet.webViewLink, merged: true, wrongCourier: currentRow.courier !== courier, crossDay: true };
    }
  }

  if (!duplicate && !isIssueScan) {
    const adminMatchAnyCourier = await findRowsAcrossDays({
      token,
      spreadsheetId: sheet.id,
      currentDate: date,
      code: normalizedCode,
      field: 'adminCode',
      cache: crossDayCache,
    });
    if (adminMatchAnyCourier && adminMatchAnyCourier.row.courier !== courier) {
      const currentRow = adminMatchAnyCourier.row;
      const correctedNote = [currentRow.note, `แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก ${courier})`].filter(Boolean).join(' | ');
      // Same invariant as the cross-day merge above: column C names the row's own sheet.
      const mergedRow = withMarketplaceCells([
        currentRow.no, currentRow.courierNo, adminMatchAnyCourier.date, time, currentRow.courier, normalizedCode, email, packer,
        'Success', correctedNote, currentRow.adminDate || effectiveAdminDate || adminMatchAnyCourier.date, currentRow.adminTime || effectiveAdminTime || '', currentRow.adminCode || effectiveAdminCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
      const confirmedRow = await updateDailyRow({ token, spreadsheetId: sheet.id, date: adminMatchAnyCourier.date, rowNumber: currentRow.sheetRowNumber, row: mergedRow });
      const resultRows = adminMatchAnyCourier.parsedRows
        .map((row) => row.sheetRowNumber === currentRow.sheetRowNumber ? rowFromSheet(mergedRow) : row)
        .filter((row) => row.courier === currentRow.courier)
        .reverse()
        .slice(0, 20);
      return {
        status: 'success', courier: currentRow.courier, selectedCourier: courier, date, time, code: normalizedCode,
        row: confirmedRow,
        rows: resultRows,
        sheetUrl: sheet.webViewLink, merged: true, wrongCourier: true, crossDay: adminMatchAnyCourier.date !== date,
      };
    }
  }

  // A Packer row from an earlier day. Every cross-day search above looks at the Admin column
  // only, so a parcel whose original row was created by a Packer — no Admin scan on it — was
  // invisible from today and got a second row appended here. Yesterday's row then stayed
  // รอแพ็ค and its COUNTIF kept counting it, while Firestore had correctly updated the
  // original order: the two sources disagreed about the same parcel.
  if (!duplicate && !isIssueScan) {
    const packerMatch = await findRowsAcrossDays({
      token,
      spreadsheetId: sheet.id,
      currentDate: date,
      code: normalizedCode,
      field: 'code',
      cache: crossDayCache,
    });
    const resolution = resolveCrossDayPackerRow(packerMatch?.row, { packerName: packer });

    if (resolution.action === 'fill-packer') {
      const currentRow = resolution.row;
      // Column C keeps naming the sheet the row lives on: rowFromSheet reads row.date from it
      // and updateScanIssueGoogle uses that to pick which sheet to search later.
      const mergedRow = withMarketplaceCells([
        currentRow.no, currentRow.courierNo, packerMatch.date, currentRow.time || time,
        currentRow.courier, currentRow.code || normalizedCode, currentRow.email || email, packer,
        'Success', currentRow.note || note,
        currentRow.adminDate || effectiveAdminDate || '', currentRow.adminTime || effectiveAdminTime || '',
        currentRow.adminCode || effectiveAdminCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

      const confirmedRow = await updateDailyRow({
        token,
        spreadsheetId: sheet.id,
        date: packerMatch.date,
        rowNumber: currentRow.sheetRowNumber,
        row: mergedRow,
      });

      const resultRows = packerMatch.parsedRows
        .map((row) => row.sheetRowNumber === currentRow.sheetRowNumber ? rowFromSheet(mergedRow) : row)
        .filter((row) => row.courier === currentRow.courier)
        .reverse()
        .slice(0, 20);

      return {
        status: 'success',
        courier: currentRow.courier,
        selectedCourier: courier,
        date,
        time,
        code: normalizedCode,
        row: confirmedRow,
        rows: resultRows,
        sheetUrl: sheet.webViewLink,
        merged: true,
        wrongCourier: currentRow.courier !== courier,
        crossDay: true,
        updatedDate: packerMatch.date,
      };
    }

    if (resolution.action === 'duplicate') {
      // Already scanned, just on an earlier sheet. Reporting it as a duplicate is the whole
      // point: appending here is what produced the second row.
      const currentRow = resolution.row;
      return {
        status: 'duplicate',
        courier: currentRow.courier,
        selectedCourier: courier,
        date,
        time,
        code: normalizedCode,
        isPacker: true,
        row: currentRow,
        rows: packerMatch.parsedRows
          .filter((row) => row.courier === currentRow.courier)
          .reverse()
          .slice(0, 20),
        sheetUrl: sheet.webViewLink,
        crossDay: true,
        updatedDate: packerMatch.date,
      };
    }
  }

  if (duplicateRow && isIssueScan) {
    const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    const verifyParsed = verifyRows.map(rowFromSheet);
    const verifyCourierRows = verifyParsed.filter((row) => row.courier === courier);
    const verifyIdx = verifyParsed.findIndex(
      (row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
    );

    if (verifyIdx !== -1) {
      const currentRow = verifyParsed[verifyIdx];
      const rowNumber = verifyIdx + 2;

      const updatedRow = withMarketplaceCells([
        currentRow.no,
        currentRow.courierNo,
        currentRow.date,
        currentRow.time,
        currentRow.courier,
        currentRow.code,
        currentRow.email,
        currentRow.packer,
        issueMeta.sheetStatus,
        note,
        currentRow.adminDate || '',
        currentRow.adminTime || '',
        currentRow.adminCode || '',
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

      const confirmedRow = await updateDailyRow({ token, spreadsheetId: sheet.id, date, rowNumber, row: updatedRow });

      const nextRows = verifyParsed
        .map((row) => (row.no === currentRow.no ? rowFromSheet(updatedRow) : row))
          .filter((row) => row.courier === currentRow.courier)
        .reverse();
      return {
        status: issueMeta.resultStatus,
        courier,
        date,
        time,
        code: normalizedCode,
        row: confirmedRow,
        count: verifyCourierRows.length,
        rows: nextRows,
        sheetUrl: sheet.webViewLink,
      };
    }
  }

  // Admin may arrive after Packer. When the Packer row already exists, merge
  // the Admin columns into that row instead of returning duplicate and losing
  // the Drive scan on Sheet.
  if (duplicateRow && !isIssueScan && effectiveAdminCode) {
    const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    const verifyParsed = verifyRows.map(rowFromSheet);
    const targetIdx = verifyParsed.findIndex((row) => normalizeScanCode(row.code) === normalizedCode);
    if (targetIdx !== -1) {
      const currentRow = verifyParsed[targetIdx];
      const mergedRow = withMarketplaceCells([
        currentRow.no,
        currentRow.courierNo,
        currentRow.date,
        currentRow.time,
        currentRow.courier,
        currentRow.code,
        currentRow.email,
        currentRow.packer,
        currentRow.status || 'Success',
        currentRow.note || note,
        effectiveAdminDate || currentRow.adminDate || currentRow.date,
        effectiveAdminTime || currentRow.adminTime || currentRow.time,
        effectiveAdminCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
      const confirmedRow = await updateDailyRow({
        token,
        spreadsheetId: sheet.id,
        date,
        rowNumber: targetIdx + 2,
        row: mergedRow,
      });
      return {
        status: 'admin_matched',
        courier: currentRow.courier,
        date,
        time,
        code: normalizedCode,
        row: confirmedRow,
        rows: verifyParsed.filter((row) => row.courier === courier).reverse().slice(0, 20),
        sheetUrl: sheet.webViewLink,
        merged: true,
      };
    }

    const packerMatchAnyCourier = await findRowsAcrossDays({
      token,
      spreadsheetId: sheet.id,
      currentDate: date,
      code: normalizedCode,
      field: 'code',
      cache: crossDayCache,
    });
    if (packerMatchAnyCourier) {
      return {
        status: 'duplicate',
        courier: packerMatchAnyCourier.row.courier,
        selectedCourier: courier,
        date,
        time,
        code: normalizedCode,
        isPacker: true,
        row: packerMatchAnyCourier.row,
        rows: packerMatchAnyCourier.parsedRows
          .filter((row) => row.courier === packerMatchAnyCourier.row.courier)
          .reverse()
          .slice(0, 20),
        sheetUrl: sheet.webViewLink,
        crossDay: true,
      };
    }
  }

  if (duplicate && !isIssueScan) {
    return {
      status: 'duplicate',
      courier,
      date,
      time,
      code: normalizedCode,
      isPacker: true,
      count: courierRows.length,
      row: duplicateRow,
      rows: courierRows.reverse().slice(0, 20),
      sheetUrl: sheet.webViewLink,
    };
  }

  const placeholder = `_TEMP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const placeholderRow = withMarketplaceCells([
    placeholder,
    placeholder,
    date,
    time,
    courier,
    normalizedCode,
    email,
    packer,
    issueMeta.sheetStatus,
    note,
    effectiveAdminDate,
    effectiveAdminTime,
    effectiveAdminCode,
  ], marketplaceOrder);

  // Read existing rows to find the next empty row (avoid unreliable append API)
  const colARange = `${escapeSheetName(date)}!A:A`;
  const colAData = await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(colARange)}?majorDimension=COLUMNS`,
    token,
  );
  const existingColA = colAData.values?.[0] ?? [];
  // Row 1 = header, so next row = existingColA.length + 1
  const appendedRowNumber = existingColA.length + 1;
  const insertedIdx = appendedRowNumber - 2;

  // Write placeholder row using UPDATE (PUT) at the computed row — avoids append pitfalls
  const writeRange = `${escapeSheetName(date)}!A${appendedRowNumber}:${sheetEndColumn()}${appendedRowNumber}`;
  await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({ values: [placeholderRow] }),
    },
  );

  // Verify placeholder was written correctly by reading the specific cell
  const verifyRange = `${escapeSheetName(date)}!A${appendedRowNumber}`;
  const verifyData = await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(verifyRange)}`,
    token,
  );
  const writtenCell = verifyData.values?.[0]?.[0];
  if (String(writtenCell) !== placeholder) {
    // Another writer claimed this row between our PUT and this read — the write lock can
    // expire mid-scan, since one scan makes ~12 API calls and backs off on 429s. Only
    // reclaim the row when it is empty (our own partial write): clearing a row that now
    // holds another device's scan would destroy that scan outright.
    if (!String(writtenCell ?? '').trim()) {
      await clearSheetRange({
        token, spreadsheetId: sheet.id,
        range: `${escapeSheetName(date)}!A${appendedRowNumber}:${sheetEndColumn()}${appendedRowNumber}`,
      }).catch(() => {});
    }
    throw new Error('ตรวจสอบข้อมูลที่เขียนลง Google Sheet ไม่สำเร็จ กรุณาสแกนอีกครั้ง');
  }

  const updatedRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const updatedParsedRows = updatedRows.map((row, idx) => rowFromSheet(row, idx));
  const updatedCourierRows = updatedParsedRows.filter((row) => row.courier === courier);

  const concurrentCodes = updatedCourierRows.filter(
    (row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
  );
  const concurrentDuplicate = concurrentCodes.length > 1;

  // Find the placeholder row index; may differ from insertedIdx if other inserts happened concurrently
  const placeholderIdx = updatedParsedRows.findIndex((row) => String(row.no) === placeholder);
  const correctNo = placeholderIdx >= 0 ? placeholderIdx + 1 : insertedIdx + 1;
  const correctCourierNo =
    updatedCourierRows.findIndex((row) => String(row.no) === placeholder) + 1;

  const correctedRow = withMarketplaceCells([
    correctNo,
    correctCourierNo,
    date,
    time,
    courier,
    normalizedCode,
    email,
    packer,
    concurrentDuplicate ? 'Duplicate' : issueMeta.sheetStatus,
    concurrentDuplicate ? 'Duplicate (concurrent scan)' : note,
    effectiveAdminDate,
    effectiveAdminTime,
    effectiveAdminCode,
  ], marketplaceOrder);

  const targetRowNumber = placeholderIdx >= 0 ? placeholderIdx + 2 : insertedIdx + 2;
  const confirmedRow = await updateDailyRow({
    token,
    spreadsheetId: sheet.id,
    date,
    rowNumber: targetRowNumber,
    row: correctedRow,
  });

  // Best-effort: never fail an otherwise-good scan because an older row could not be tidied.
  await repairPlaceholderRows({
    token, spreadsheetId: sheet.id, date, parsedRows: updatedParsedRows, skipPlaceholder: placeholder,
  }).catch(() => {});

  const resultRows = updatedParsedRows
    .filter((row) => row.courier === courier)
    .map((row) => (String(row.no) === placeholder ? rowFromSheet(correctedRow) : row))
    .reverse()
    .slice(0, 20);

  return {
    status: concurrentDuplicate ? 'duplicate' : issueMeta.resultStatus,
    courier,
    date,
    time,
    code: normalizedCode,
    count: updatedCourierRows.length,
    row: confirmedRow,
    rows: resultRows,
    sheetUrl: sheet.webViewLink,
  };
}

/**
 * appendAdminScanGoogle
 * Admin "down Drive" scan — saves tracking number into columns K, L, M.
 * If packer already scanned this code (column F), merge admin data into that row.
 */
export async function appendAdminScanGoogle({
  token,
  config,
  courier,
  code,
  email,
  marketplaceOrder = null,
  scanDate = null,
  scanTime = null,
  adminDate = null,
  adminTime = null,
  adminCode = null,
}) {
  const normalizedCode = normalizeScanCode(code);
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const nowParts = getBangkokParts();
  const date = scanDate || nowParts.date;
  const time = scanTime || nowParts.time;
  const effectiveAdminDate = adminDate || date;
  const effectiveAdminTime = adminTime || time;
  const effectiveAdminCode = normalizeScanCode(adminCode || normalizedCode);
  await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });
  const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const parsedRows = rows.map(rowFromSheet);
  // The Packer path memoises its cross-day reads; this one never did, so each of the two
  // searches below re-fetched the spreadsheet listing and re-read the same four days.
  const crossDayCache = createCrossDayCache();

  // 1) Reconcile against the existing row before any write.
  const reconciliation = findScanReconciliation(parsedRows, {
    courier,
    code: normalizedCode,
    isPacker: false,
  });
  if (reconciliation.action === 'skip') {
    return {
      status: 'duplicate',
      courier: reconciliation.row.courier,
      selectedCourier: courier,
      date,
      time,
      code: normalizedCode,
      isPacker: false,
      row: reconciliation.row,
      rows: parsedRows.filter((r) => r.courier === reconciliation.row.courier).reverse().slice(0, 20),
      sheetUrl: sheet.webViewLink,
    };
  }

  // 2) If Packer already scanned, merge Admin data into that row.
  const packerRow = reconciliation.action === 'merge-admin' ? reconciliation.row : null;

  if (packerRow) {
    // Merge: update existing row with admin fields
    // Re-read for fresh position
    const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    const verifyParsed = verifyRows.map(rowFromSheet);
    const targetIdx = verifyParsed.findIndex(
      (row) => normalizeScanCode(row.code) === normalizedCode,
    );
    if (targetIdx !== -1) {
      const currentRow = verifyParsed[targetIdx];
      const mergedRow = withMarketplaceCells([
        currentRow.no,
        currentRow.courierNo,
        currentRow.date,
        currentRow.time,
        currentRow.courier,
        currentRow.code,
        currentRow.email,
        currentRow.packer,
        currentRow.status || 'Success',
        currentRow.note || '',
        effectiveAdminDate,
        effectiveAdminTime,
        effectiveAdminCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

      const confirmedRow = await updateDailyRow({
        token,
        spreadsheetId: sheet.id,
        date,
        rowNumber: targetIdx + 2,
        row: mergedRow,
      });

      const resultRows = verifyParsed
        .map((row) => row.sheetRowNumber === targetIdx + 2 ? rowFromSheet(mergedRow) : row)
        .filter((r) => r.courier === currentRow.courier)
        .reverse()
        .slice(0, 20);

      return {
        status: 'admin_matched',
        courier: currentRow.courier,
        date,
        time,
        code: normalizedCode,
        isPacker: false,
        row: confirmedRow,
        rows: resultRows,
        sheetUrl: sheet.webViewLink,
      };
    }
  }

  const crossDayAdminMatch = await findRowsAcrossDays({ token, spreadsheetId: sheet.id, currentDate: date, code: effectiveAdminCode, field: 'adminCode', cache: crossDayCache });
  if (crossDayAdminMatch) {
    return {
      status: 'duplicate',
      courier: crossDayAdminMatch.row.courier,
      selectedCourier: courier,
      date,
      time,
      code: normalizedCode,
      isPacker: false,
      row: crossDayAdminMatch.row,
      rows: crossDayAdminMatch.parsedRows.filter((row) => row.courier === crossDayAdminMatch.row.courier).reverse().slice(0, 20),
      sheetUrl: sheet.webViewLink,
      crossDay: true,
    };
  }

  const crossDayMatch = await findRowsAcrossDays({ token, spreadsheetId: sheet.id, currentDate: date, code: normalizedCode, field: 'code', cache: crossDayCache });
  if (crossDayMatch) {
    const currentRow = crossDayMatch.row;
    const mergedRow = withMarketplaceCells([
      currentRow.no, currentRow.courierNo, currentRow.date, currentRow.time, currentRow.courier, currentRow.code,
      currentRow.email, currentRow.packer, currentRow.status || 'Success', currentRow.note || '', effectiveAdminDate, effectiveAdminTime, effectiveAdminCode,
    ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
    const confirmedRow = await updateDailyRow({ token, spreadsheetId: sheet.id, date: crossDayMatch.date, rowNumber: currentRow.sheetRowNumber, row: mergedRow });
    const resultRows = crossDayMatch.parsedRows
      .map((row) => row.sheetRowNumber === currentRow.sheetRowNumber ? rowFromSheet(mergedRow) : row)
      .filter((row) => row.courier === currentRow.courier)
      .reverse()
      .slice(0, 20);
    return { status: 'admin_matched', courier: currentRow.courier, date, time, code: normalizedCode, isPacker: false, row: confirmedRow, rows: resultRows, sheetUrl: sheet.webViewLink, crossDay: true };
  }

  // 3) New admin-only row — write with computed next row (avoid unreliable append API)
  const placeholder = `_TEMP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const placeholderRow = withMarketplaceCells([
    placeholder,
    placeholder,
    date,
    time,
    courier,
    '',
    email,
    '',
    'รอแพ็ค',
    '',
    effectiveAdminDate,
    effectiveAdminTime,
    effectiveAdminCode,
  ], marketplaceOrder);

  // Read column A to compute next empty row
  const colARange = `${escapeSheetName(date)}!A:A`;
  const colAData = await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(colARange)}?majorDimension=COLUMNS`,
    token,
  );
  const existingColA = colAData.values?.[0] ?? [];
  const appendedRowNumber = existingColA.length + 1;
  const insertedIdx = appendedRowNumber - 2;

  const writeRange = `${escapeSheetName(date)}!A${appendedRowNumber}:${sheetEndColumn()}${appendedRowNumber}`;
  await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`,
    token,
    {
      method: 'PUT',
      body: JSON.stringify({ values: [placeholderRow] }),
    },
  );

  // Verify placeholder was written correctly by reading the specific cell
  const verifyRange = `${escapeSheetName(date)}!A${appendedRowNumber}`;
  const verifyData = await apiFetch(
    `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(verifyRange)}`,
    token,
  );
  const writtenCell = verifyData.values?.[0]?.[0];
  if (String(writtenCell) !== placeholder) {
    // See the packer path: only reclaim an empty row, never one another writer now owns.
    if (!String(writtenCell ?? '').trim()) {
      await clearSheetRange({
        token, spreadsheetId: sheet.id,
        range: `${escapeSheetName(date)}!A${appendedRowNumber}:${sheetEndColumn()}${appendedRowNumber}`,
      }).catch(() => {});
    }
    throw new Error('ยืนยันการเพิ่มแถวใน Google Sheet ไม่สำเร็จ กรุณาสแกนอีกครั้ง');
  }

  const updatedRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const updatedParsedRows = updatedRows.map((row, idx) => rowFromSheet(row, idx));

  // Locate the placeholder positionally, the same way the packer path does. The previous
  // code counted matching rows and then added 1 unconditionally, but `updatedParsedRows`
  // is read *after* the placeholder (which already carries effectiveAdminCode) was
  // written, so the new row was counted twice and the first admin scan of a courier got 2.
  const placeholderIdx = updatedParsedRows.findIndex((r) => String(r.no) === placeholder);
  const correctNo = placeholderIdx >= 0 ? placeholderIdx + 1 : insertedIdx + 1;
  const courierAdminRows = updatedParsedRows.filter(
    (r) => r.courier === courier && r.adminCode && r.adminCode.trim() !== '',
  );
  const placeholderCourierIdx = courierAdminRows.findIndex((r) => String(r.no) === placeholder);
  const correctCourierNo = placeholderCourierIdx >= 0
    ? placeholderCourierIdx + 1
    : courierAdminRows.length;

  const correctedRow = withMarketplaceCells([
    correctNo,
    correctCourierNo,
    date,
    time,
    courier,
    '',
    email,
    '',
    'รอแพ็ค',
    '',
    effectiveAdminDate,
    effectiveAdminTime,
    effectiveAdminCode,
  ], marketplaceOrder);

  // Write where the placeholder actually is, not where it was expected to land. The Packer
  // path already does this; here the corrected row went to `appendedRowNumber` — the position
  // computed from column A *before* the re-read. If a row was deleted by hand in Sheets in
  // between (see AGENTS.md §7) the two differ, and the corrected row overwrote a real scan
  // while leaving the _TEMP_ marker stranded.
  const targetRowNumber = placeholderIdx >= 0 ? placeholderIdx + 2 : appendedRowNumber;
  const confirmedRow = await updateDailyRow({
    token,
    spreadsheetId: sheet.id,
    date,
    rowNumber: targetRowNumber,
    row: correctedRow,
  });

  // Best-effort, same as the Packer path: an admin-only day would otherwise never get its
  // stranded markers repaired, because only the Packer path used to run this.
  await repairPlaceholderRows({
    token, spreadsheetId: sheet.id, date, parsedRows: updatedParsedRows, skipPlaceholder: placeholder,
  }).catch(() => {});

  const driveRows = updatedParsedRows
    .filter((row) => row.adminCode && row.adminCode.trim() !== '')
    .reverse()
    .slice(0, 20);

  return {
    status: 'admin_scan',
    courier,
    date,
    time,
    code: normalizedCode,
    isPacker: false,
    row: confirmedRow,
    rows: driveRows,
    sheetUrl: sheet.webViewLink,
  };
}

export async function updateScanIssueGoogle({ token, config, row, issue }) {
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const currentRows = await readDailyRows({ token, spreadsheetId: sheet.id, date: row.date });
  const currentParsed = currentRows.map(rowFromSheet);
  const targetIdx = currentParsed.findIndex(
    (r) => normalizeScanCode(r.code) === normalizeScanCode(row.code) && r.courier === row.courier,
  );

  if (targetIdx === -1) {
    throw new Error('ไม่พบรายการใน Google Sheet (อาจถูกลบหรือย้ายแล้ว)');
  }

  const currentRow = currentParsed[targetIdx];
  const rowNumber = targetIdx + 2;

  const status = issue === 'สินค้าเสียหาย' ? 'Damaged' : issue === 'ลูกค้ายกเลิก' ? 'Cancelled' : 'Issue';
  const updatedRow = withMarketplaceCells([
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
    currentRow.adminDate || '',
    currentRow.adminTime || '',
    currentRow.adminCode || '',
  ], marketplaceOrderFromRow(currentRow));

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

/**
 * Cross-check admin scans against packer scans within the lookback window.
 */
export async function checkMissingOrders({
  token,
  config,
  courier = null,
  hoursLookback = 48,
  thresholdMinutes = 30,
}) {
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const now = new Date();
  const lookbackMs = hoursLookback * 60 * 60 * 1000;
  const thresholdMs = thresholdMinutes * 60 * 1000;

  // Get all sheet dates
  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const sheetTitles = (spreadsheet.sheets?.map((item) => item.properties.title) ?? [])
    .filter((title) => /^\d{4}-\d{2}-\d{2}$/.test(title));

  // Filter to dates within lookback window
  const relevantDates = sheetTitles.filter((title) => {
    const d = parseDateOnly(title);
    if (!d) return false;
    // The elapsed time is negative for a tab dated in the future, which used to pass the
    // upper bound and drag a mistyped tab into every missing-order report. Bangkok is UTC+7,
    // so today's tab is legitimately up to 7h "ahead" of its UTC midnight.
    const elapsedMs = now.getTime() - d.getTime();
    return elapsedMs >= -BANGKOK_UTC_OFFSET_MS && elapsedMs <= lookbackMs;
  });

  const matched = [];
  const pending = [];
  const pendingOverOneDay = [];
  const tooSoon = [];
  const cancelled = [];
  const returned = [];
  const damaged = [];

  const rowsBySheet = await batchReadDailyRows({ token, spreadsheetId: sheet.id, sheetNames: relevantDates });

  for (const date of relevantDates) {
    const rows = (rowsBySheet.get(date) ?? []).map(rowFromSheet);

    for (const row of rows) {
      // Only consider rows that admin scanned
      if (!row.adminCode || row.adminCode.trim() === '') continue;

      // Filter by courier if specified
      if (courier && row.courier !== courier) continue;

      const adminTimeStr = row.adminTime || row.time || '00:00:00';
      const adminDateStr = row.adminDate || row.date || date;
      const adminDateTime = parseDateTime(adminDateStr, adminTimeStr);

      const isCancelled = row.status === 'Cancelled' || row.note === 'ลูกค้ายกเลิก';
      const isReturned = row.status === 'Returned' || row.note === 'สินค้าตีกลับ';
      const isDamaged = row.status === 'Damaged' || row.note === 'สินค้าเสียหาย';

      if (isCancelled) {
        cancelled.push({ ...row, _sheetDate: date });
      } else if (isReturned) {
        // A returned parcel is a closed outcome, not an unpacked one. Without this branch it
        // failed the `status === 'Success'` test below and landed in `pending`, so every
        // return was reported as a missing order for ever (and as danger after 24h).
        returned.push({ ...row, _sheetDate: date });
      } else if (isDamaged) {
        damaged.push({ ...row, _sheetDate: date });
      } else if (row.status === 'Success' && row.code && row.code.trim() !== '') {
        // Packer has scanned → matched
        matched.push({ ...row, _sheetDate: date });
      } else if (adminDateTime) {
        const elapsed = now.getTime() - adminDateTime.getTime();
        if (elapsed < thresholdMs) {
          tooSoon.push({ ...row, _sheetDate: date });
        } else {
          const item = { ...row, _sheetDate: date };
          pending.push(item);
          if (elapsed >= 24 * 60 * 60 * 1000) pendingOverOneDay.push(item);
        }
      } else {
        // No admin time → treat as pending
        pending.push({ ...row, _sheetDate: date });
      }
    }
  }

  return {
    matched,
    pending,
    pendingOverOneDay,
    tooSoon,
    cancelled,
    returned,
    damaged,
    totalAdminScans: matched.length + pending.length + tooSoon.length
      + cancelled.length + returned.length + damaged.length,
    checkTime: new Date().toISOString(),
    thresholdMinutes,
    hoursLookback,
  };
}

function rowFromSheet(row, index = null) {
  // Google Sheets omits trailing empty cells. Legacy rows (before admin
  // columns K-M were added) may only have 9-10 cells. Detect the schema by
  // checking whether row[7] contains a known status value (old schema:
  // Status at index 7, no Packer column) rather than relying on row length
  // because trailing empty cells can make old rows appear longer.
  const KNOWN_STATUSES = new Set(['Success', 'Cancelled', 'Damaged', 'Issue', 'Returned', 'รอแพ็ค']);
  const maybeStatus = String(row[7] ?? '').trim();
  const hasPackerColumn = row.length >= 10 && !KNOWN_STATUSES.has(maybeStatus);
  const hasAdminColumns = row.length >= 13;
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
    adminDate: hasAdminColumns ? row[10] ?? '' : '',
    adminTime: hasAdminColumns ? row[11] ?? '' : '',
    adminCode: hasAdminColumns ? row[12] ?? '' : '',
    marketplacePlatform: row[13] ?? '',
    marketplaceOrderId: row[14] ?? '',
    buyerName: row[15] ?? '',
    marketplaceItems: row[16] ?? '',
    marketplaceSkus: row[17] ?? '',
    marketplaceItemQty: row[18] ?? '',
    marketplaceStatus: row[19] ?? '',
    orderStatus: row[20] ?? '',
    crossDay: row[21] ?? '',
    syncStatus: row[22] ?? '',
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

function getLookbackDates(date, days = CROSS_DAY_LOOKBACK) {
  const base = parseDateOnly(date);
  if (!base) return [];
  return Array.from({ length: days + 1 }, (_, offset) => {
    const value = new Date(base);
    value.setUTCDate(value.getUTCDate() - offset);
    return formatDateOnly(value);
  });
}

/**
 * Per-scan memo for the cross-day searches.
 *
 * One scan runs several of them and they all walk the same handful of sheets. Without this each
 * search re-fetched the spreadsheet listing and re-read every day again — a scan already costs
 * about a dozen Google API calls, and the sheet lock it competes with has a limited TTL.
 */
function createCrossDayCache() {
  return { titles: null, rows: new Map() };
}

async function findRowsAcrossDays({ token, spreadsheetId, currentDate, courier = null, code, field, matcher = null, cache = null }) {
  const normalizedCode = normalizeScanCode(code);
  const memo = cache ?? createCrossDayCache();
  if (!memo.titles) {
    const spreadsheet = await getSpreadsheet(token, spreadsheetId);
    memo.titles = new Set((spreadsheet.sheets ?? []).map((item) => item.properties.title));
  }
  const titles = memo.titles;
  for (const date of getLookbackDates(currentDate)) {
    if (!titles.has(date)) continue;
    if (!memo.rows.has(date)) {
      memo.rows.set(date, await readDailyRows({ token, spreadsheetId, date }));
    }
    const rows = memo.rows.get(date);
    const parsedRows = rows.map((row, index) => rowFromSheet(row, index));
    const match = matcher
      ? matcher(parsedRows)
      : parsedRows.find(
          (row) => (!courier || row.courier === courier) && normalizeScanCode(row[field]) === normalizedCode,
        );
    if (match) return { date, parsedRows, row: match };
  }
  return null;
}

export function findCancellationRow(rows, { courier, code }) {
  const normalizedCode = normalizeScanCode(code);
  return rows.find(
    (row) => row.courier === courier && normalizeScanCode(row.code) === normalizedCode,
  ) ?? rows.find(
    (row) => row.courier === courier && normalizeScanCode(row.adminCode) === normalizedCode,
  ) ?? null;
}

// Sheet date/time columns hold Bangkok wall clock (see getBangkokParts). Building the
// instant with Date.UTC alone would place it 7h in the future, making every
// `Date.now() - parseDateTime(...)` elapsed check 7h too small.
const BANGKOK_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

function parseDateTime(dateStr, timeStr) {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  const parts = /^(\d{2}):(\d{2}):(\d{2})$/.exec(timeStr);
  if (parts) {
    d.setUTCHours(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  } else {
    const simple = /^(\d{2}):(\d{2})$/.exec(timeStr);
    if (simple) {
      d.setUTCHours(Number(simple[1]), Number(simple[2]), 0);
    }
  }
  return new Date(d.getTime() - BANGKOK_UTC_OFFSET_MS);
}

/**
 * batchAppendScanGoogle — appends multiple packer/admin scan orders into the
 * same daily worksheet in ONE round of API calls (get sheet → append all →
 * batch-update all).  This avoids the per-order loop that hits the 60 req/min
 * Sheets quota when recovering more than a handful of pending syncs.
 *
 * @param {{ token, config, orders, repairExisting? }} params
 *   orders: Array<{ code, courier, date?, email, packer?, note?, isPacker, marketplaceOrder? }>
 * @returns {Promise<Array<{ order, result, error? }>>}
 */
export async function batchAppendScanGoogle({ token, config, orders, repairExisting = false }) {
  if (!orders?.length) return [];
  const sheet = config?.master;
  if (!sheet?.id) throw new Error('ไม่พบ Google Sheet Master');

  const { date: todayDate, time: todayTime } = getBangkokParts();

  // 1. Normalize and group by date
  const normalizedOrders = orders.map((order) => ({
    ...order,
    normalizedCode: normalizeScanCode(order.code || ''),
    date: order.date || todayDate,
    time: order.time || todayTime,
  }));
  const byDate = new Map();
  for (const order of normalizedOrders) {
    if (!byDate.has(order.date)) byDate.set(order.date, []);
    byDate.get(order.date).push(order);
  }

  const results = [];
  const spreadsheet = await getSpreadsheet(token, sheet.id);
  const availableSheetTitles = new Set((spreadsheet.sheets ?? []).map((item) => item.properties.title));

  // 2. Process each date sheet
  for (const [date, dateOrders] of byDate) {
    try {
      // a) Ensure the daily worksheet exists (1 read + optional create)
      await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });

      // b) Read existing rows once (1 read)
      const existingRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
      const existingParsed = existingRows.map((row, idx) => rowFromSheet(row, idx));
      const workingParsed = existingParsed.slice();
      const historicalParsed = [];
      for (const historicalDate of getLookbackDates(date).slice(1)) {
        if (!availableSheetTitles.has(historicalDate)) continue;
        const historicalRows = await readDailyRows({ token, spreadsheetId: sheet.id, date: historicalDate });
        historicalParsed.push(
          ...historicalRows.map((row, idx) => ({ ...rowFromSheet(row, idx), _sheetDate: historicalDate })),
        );
      }
      const reconciliationRows = [...workingParsed, ...historicalParsed];

      // c) Build placeholder rows and batch-append all at once (1 write)
      const placeholders = [];
      const placeholderMeta = []; // track which placeholder maps to which order
      const directUpdates = [];
      let didWriteSheet = false;
      for (const order of dateOrders) {
        const { normalizedCode, courier, email, packer, note, isPacker, adminDate, adminTime, adminCode } = order;
        const issueMeta = isPacker ? getScanIssueMeta(note) : null;
        const expectedStatus = isPacker ? issueMeta.sheetStatus : 'รอแพ็ค';
        const resultStatus = isPacker ? issueMeta.resultStatus : 'admin_scan';
        const reconciliation = findScanReconciliation(reconciliationRows, {
          courier, code: normalizedCode, isPacker, packerName: packer,
        });

        if (reconciliation.action === 'skip') {
          const currentRow = reconciliation.row;
          if (repairExisting) {
            const repairedRow = withMarketplaceCells([
              currentRow.no,
              currentRow.courierNo,
              currentRow.date,
              currentRow.time,
              currentRow.courier,
              currentRow.code,
              currentRow.email,
              currentRow.packer,
              expectedStatus,
              currentRow.note,
              currentRow.adminDate,
              currentRow.adminTime,
              currentRow.adminCode,
            ], order.marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
            const needsRepair = String(currentRow.status ?? '').trim() !== expectedStatus
              || String(currentRow.note ?? '') !== String(repairedRow[9] ?? '');
            if (!needsRepair) {
              results.push({
                order,
                result: {
                  status: 'duplicate',
                  courier,
                  date,
                  time: order.time,
                  code: normalizedCode,
                  isPacker: Boolean(isPacker),
                  row: reconciliation.row,
                  rows: existingParsed.filter((row) => row.courier === courier).reverse().slice(0, 20),
                  sheetUrl: sheet.webViewLink,
                },
              });
              continue;
            }
            let confirmedRow = null;
            if (currentRow._sheetDate && currentRow._sheetDate !== date) {
              confirmedRow = await updateDailyRow({
                token,
                spreadsheetId: sheet.id,
                date: currentRow._sheetDate,
                rowNumber: currentRow.sheetRowNumber,
                row: repairedRow,
              });
            } else {
              directUpdates.push({ rowNumber: currentRow.sheetRowNumber, row: repairedRow });
            }
            const reconciliationIndex = reconciliationRows.findIndex(
              (row) => row.sheetRowNumber === currentRow.sheetRowNumber && row._sheetDate === currentRow._sheetDate,
            );
            if (reconciliationIndex !== -1) {
              reconciliationRows[reconciliationIndex] = {
                ...rowFromSheet(repairedRow, currentRow.sheetRowNumber - 2),
                _sheetDate: currentRow._sheetDate || date,
              };
            }
            results.push({
              order,
              result: {
                status: resultStatus,
                courier,
                date,
                time: order.time,
                code: normalizedCode,
                isPacker: Boolean(isPacker),
                row: confirmedRow ?? rowFromSheet(repairedRow, currentRow.sheetRowNumber - 2),
                rows: [],
                sheetUrl: sheet.webViewLink,
                repaired: true,
                crossDay: Boolean(currentRow._sheetDate && currentRow._sheetDate !== date),
              },
            });
            continue;
          }
          results.push({
            order,
            result: {
              status: 'duplicate',
              courier,
              date,
              time: order.time,
              code: normalizedCode,
              isPacker: Boolean(isPacker),
              row: reconciliation.row,
              rows: existingParsed.filter((row) => row.courier === courier).reverse().slice(0, 20),
              sheetUrl: sheet.webViewLink,
            },
          });
          continue;
        }

        if (reconciliation.action === 'merge-admin' || reconciliation.action === 'merge-packer') {
          const currentRow = reconciliation.row;
          const mergedRow = reconciliation.action === 'merge-admin'
            ? withMarketplaceCells([
                currentRow.no,
                currentRow.courierNo,
                currentRow.date,
                currentRow.time,
                currentRow.courier,
                currentRow.code,
                currentRow.email,
                currentRow.packer,
                currentRow.status || 'Success',
                currentRow.note || '',
                adminDate || date,
                adminTime || order.time,
                adminCode || normalizedCode,
              ], order.marketplaceOrder ?? marketplaceOrderFromRow(currentRow))
            : withMarketplaceCells([
                currentRow.no,
                currentRow.courierNo,
                date,
                order.time,
                currentRow.courier,
                normalizedCode,
                email,
                packer || '',
                issueMeta.sheetStatus,
                note || '',
                currentRow.adminDate || adminDate || '',
                currentRow.adminTime || adminTime || '',
                currentRow.adminCode || adminCode || '',
              ], order.marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
          let confirmedRow = null;
          if (currentRow._sheetDate && currentRow._sheetDate !== date) {
            confirmedRow = await updateDailyRow({
              token,
              spreadsheetId: sheet.id,
              date: currentRow._sheetDate,
              rowNumber: currentRow.sheetRowNumber,
              row: mergedRow,
            });
          } else {
            directUpdates.push({ rowNumber: currentRow.sheetRowNumber, row: mergedRow });
          }
          const reconciliationIndex = reconciliationRows.findIndex(
            (row) => row.sheetRowNumber === currentRow.sheetRowNumber && row._sheetDate === currentRow._sheetDate,
          );
          if (reconciliationIndex !== -1) {
            reconciliationRows[reconciliationIndex] = {
              ...rowFromSheet(mergedRow, currentRow.sheetRowNumber - 2),
              _sheetDate: currentRow._sheetDate || date,
            };
          }
          results.push({
            order,
            result: {
              status: reconciliation.action === 'merge-admin' ? 'admin_matched' : resultStatus,
              courier,
              date,
              time: order.time,
              code: normalizedCode,
              row: confirmedRow ?? rowFromSheet(mergedRow, currentRow.sheetRowNumber - 2),
              rows: [],
              sheetUrl: sheet.webViewLink,
              merged: true,
              crossDay: Boolean(currentRow._sheetDate && currentRow._sheetDate !== date),
            },
          });
          continue;
        }

        const hasAdmin = Boolean(adminCode);
        const placeholder = `_TEMP_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const status = expectedStatus;
        const placeholderRow = withMarketplaceCells([
          placeholder, placeholder, date, order.time, courier,
          isPacker ? normalizedCode : '', email,
          isPacker ? (packer || '') : '',
          status, note || '',
          hasAdmin ? (adminDate || date) : '',
          hasAdmin ? (adminTime || order.time) : '',
          hasAdmin ? adminCode : '',
        ], order.marketplaceOrder ?? null);
        placeholders.push(placeholderRow);
        placeholderMeta.push({ order, placeholder, isPacker });
        reconciliationRows.push({
          ...rowFromSheet(placeholderRow, existingParsed.length + placeholders.length - 1),
          _sheetDate: date,
        });
      }

      // c.2) Compute next row from column A and write via PUT only for new rows.
      if (placeholders.length > 0) {
        const colARange = `${escapeSheetName(date)}!A:A`;
        const colAData = await apiFetch(
          `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(colARange)}?majorDimension=COLUMNS`,
          token,
        );
        const existingColA = colAData.values?.[0] ?? [];
        const startRow = existingColA.length + 1;
        const writeRange = `${escapeSheetName(date)}!A${startRow}:${sheetEndColumn()}${startRow + placeholders.length - 1}`;
        await apiFetch(
          `${SHEETS_API}/${sheet.id}/values/${encodeURIComponent(writeRange)}?valueInputOption=RAW`,
          token,
          { method: 'PUT', body: JSON.stringify({ values: placeholders }) },
        );
        didWriteSheet = true;
      }

      // d) Re-read (1 read)
      const currentRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
      const currentParsed = currentRows.map((row, idx) => rowFromSheet(row, idx));

      // e) Build batch update data — replace all placeholders with real data (1 write)
      const batchData = directUpdates.flatMap(({ rowNumber, row }) => (
        buildDailyRowUpdateData(date, rowNumber, row)
      ));
      // Only the rows this batch wrote need recolouring.
      const touchedRowNumbers = directUpdates.map(({ rowNumber }) => rowNumber);
      for (let i = 0; i < placeholderMeta.length; i++) {
        const { order, placeholder, isPacker } = placeholderMeta[i];
        // Find the placeholder row in current parsed data
        const placeholderIdx = currentParsed.findIndex(
          (row) => String(row.no) === placeholder,
        );
        if (placeholderIdx === -1) {
          results.push({ order, result: null, error: new Error('ไม่พบแถวที่เพิ่มใน Sheet (placeholder mismatch)') });
          continue;
        }

        const rowNumber = placeholderIdx + 2; // 1-based sheet row
        const correctNo = placeholderIdx + 1;

        // Count courier rows
        const courierRows = currentParsed.filter((r) => r.courier === order.courier);
        const courierRowIdx = courierRows.findIndex((r) => String(r.no) === placeholder);
        const correctCourierNo = courierRowIdx >= 0 ? courierRowIdx + 1 : correctNo;

        // Check for concurrent duplicates
        const concurrentCodes = courierRows.filter(
          (r) => normalizeScanCode(r.code) === order.normalizedCode,
        );
        const concurrentDuplicate = concurrentCodes.length > 1;

        const { normalizedCode, courier, email, packer, note, adminDate, adminTime, adminCode } = order;
        const issueMeta = isPacker ? getScanIssueMeta(note) : null;
        const expectedStatus = isPacker ? issueMeta.sheetStatus : 'รอแพ็ค';
        const resultStatus = isPacker ? issueMeta.resultStatus : 'admin_scan';
        const hasAdmin = Boolean(adminCode);
        const correctedRow = withMarketplaceCells([
          correctNo, correctCourierNo, date, order.time, courier,
          isPacker ? normalizedCode : '', email,
          isPacker ? (packer || '') : '',
          concurrentDuplicate ? 'Duplicate' : expectedStatus,
          concurrentDuplicate ? 'Duplicate (concurrent scan)' : (note || ''),
          hasAdmin ? (adminDate || date) : '',
          hasAdmin ? (adminTime || order.time) : '',
          hasAdmin ? adminCode : '',
        ], order.marketplaceOrder ?? null);

        const data = buildDailyRowUpdateData(date, rowNumber, correctedRow);
        batchData.push(...data);
        touchedRowNumbers.push(rowNumber);

        results.push({
          order,
          result: {
            status: concurrentDuplicate ? 'duplicate' : resultStatus,
            courier,
            date,
            time: order.time,
            code: normalizedCode,
            count: courierRows.length,
            row: rowFromSheet(correctedRow, rowNumber - 2),
            rows: [],
            sheetUrl: sheet.webViewLink,
          },
        });
      }

      // f) Execute batch update (1 write)
      if (batchData.length > 0) {
        await apiFetch(
          `${SHEETS_API}/${sheet.id}/values:batchUpdate`,
          token,
          { method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data: batchData }) },
        );
        didWriteSheet = true;

        const verifiedRows = (await readDailyRows({ token, spreadsheetId: sheet.id, date }))
          .map((row, index) => rowFromSheet(row, index));
        for (const item of results) {
          if (!dateOrders.includes(item.order) || item.result?.status === 'duplicate' || item.result?.crossDay) continue;
          const rowNumber = item.result?.row?.sheetRowNumber;
          if (rowNumber) {
            item.result.row = verifiedRows.find((row) => row.sheetRowNumber === rowNumber) ?? null;
          }
        }
      }

      // g) Apply status cell colors (1 read + 1 write, optional)
      if (didWriteSheet) {
        try {
          const spreadsheet = await getSpreadsheet(token, sheet.id);
          const sheetId = spreadsheet.sheets?.find((s) => s.properties.title === date)?.properties.sheetId;
          if (sheetId && touchedRowNumbers.length > 0) {
            await applyStatusCellColors({
              token, spreadsheetId: sheet.id, date, sheetId, rowNumbers: touchedRowNumbers,
            });
          }
        } catch {
          // Colors are nice-to-have, not critical
        }
      }
    } catch (error) {
      // If the whole date batch fails, mark all orders in this group as failed
      for (let index = results.length - 1; index >= 0; index -= 1) {
        if (dateOrders.includes(results[index].order)) results.splice(index, 1);
      }
      for (const order of dateOrders) {
        results.push({ order, result: null, error });
      }
    }
  }

  return results;
}
