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
    label: 'เลข KEX Lazada ต้องขึ้นต้นด้วย KEXLM แล้วตามด้วยตัวเลข',
    valid: /^KEXLM\d{8,20}$/i,
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
      lastError = new Error(`Google API rate limited (429) after ${attempt + 1} attempts`);
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

function columnLetter(columnNumber) {
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
  const items = Array.isArray(order?.items) ? order.items : [];
  return items
    .map((item) => {
      const name = String(item?.name ?? '').trim();
      const quantity = item?.quantity ? ` x${item.quantity}` : '';
      return `${name}${quantity}`.trim();
    })
    .filter(Boolean)
    .join(' | ');
}

function marketplaceSkusText(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  return items
    .map((item) => String(item?.sku ?? '').trim())
    .filter(Boolean)
    .join(' | ');
}

function marketplaceQtyText(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
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

async function getSpreadsheet(token, spreadsheetId) {
  return apiFetch(
    `${SHEETS_API}/${spreadsheetId}?fields=sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))`,
    token,
  );
}

const MANAGEMENT_SHEETS = {
  dashboard: 'Dashboard',
  audit: 'Audit Log',
  allOrders: 'All Orders',
};

async function ensureManagementSheets({ token, spreadsheetId, today = getBangkokParts().date }) {
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const sheets = spreadsheet.sheets ?? [];
  const requests = [];
  const existing = new Map(sheets.map((sheet) => [sheet.properties.title, sheet.properties]));

  if (!existing.has(MANAGEMENT_SHEETS.dashboard)) {
    requests.push({ addSheet: { properties: { title: MANAGEMENT_SHEETS.dashboard, index: 0, gridProperties: { rowCount: 100, columnCount: 8 } } } });
  }
  if (!existing.has(MANAGEMENT_SHEETS.audit)) {
    requests.push({ addSheet: { properties: { title: MANAGEMENT_SHEETS.audit, index: 1, gridProperties: { rowCount: 1000, columnCount: 9 } } } });
  }
  if (!existing.has(MANAGEMENT_SHEETS.allOrders)) {
    requests.push({ addSheet: { properties: { title: MANAGEMENT_SHEETS.allOrders, index: 2, gridProperties: { rowCount: 5000, columnCount: TOTAL_COLUMNS + 6 } } } });
  }

  for (const sheet of sheets) {
    const title = sheet.properties.title;
    if (/^\d{4}-\d{2}-\d{2}(?:_conflict\d+)?$/.test(title) && title < today && !sheet.properties.hidden) {
      requests.push({ updateSheetProperties: { properties: { sheetId: sheet.properties.sheetId, hidden: true }, fields: 'hidden' } });
    }
  }
  if (requests.length > 0) {
    await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests }) });
  }

  const refreshed = await getSpreadsheet(token, spreadsheetId);
  const dashboard = refreshed.sheets?.find((sheet) => sheet.properties.title === MANAGEMENT_SHEETS.dashboard)?.properties;
  const audit = refreshed.sheets?.find((sheet) => sheet.properties.title === MANAGEMENT_SHEETS.audit)?.properties;
  const allOrders = refreshed.sheets?.find((sheet) => sheet.properties.title === MANAGEMENT_SHEETS.allOrders)?.properties;
  if (!dashboard || !audit || !allOrders) return;

  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!A1:B2')}?valueInputOption=RAW`, token, {
    method: 'PUT',
    body: JSON.stringify({ values: [['Dashboard', 'Loading'], ['Last sync', new Date().toISOString()]] }),
  });

  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Audit Log!A1:I1')}?valueInputOption=RAW`, token, {
    method: 'PUT', body: JSON.stringify({ values: [['เวลา', 'Tracking Number', 'ผู้ใช้งาน', 'บทบาท', 'การกระทำ', 'ขนส่งเดิม', 'ขนส่งใหม่', 'ผลลัพธ์', 'หมายเหตุ']] }),
  });
  const dateSheets = refreshed.sheets?.map((sheet) => sheet.properties.title).filter((title) => /^\d{4}-\d{2}-\d{2}(?:_conflict\d+)?$/.test(title)).sort().reverse() ?? [];
  const dateList = [...new Set(dateSheets.map((title) => title.slice(0, 10)))];
  const allOrderRows = [];
  const shouldBuildAllOrders = !existing.has(MANAGEMENT_SHEETS.allOrders);
  for (const date of shouldBuildAllOrders ? dateSheets : [today]) {
    const rows = await readDailyRows({ token, spreadsheetId, date }).catch(() => []);
    for (const row of rows) {
      const hasAdmin = Boolean(String(row[11] ?? '').trim());
      const status = String(row[8] ?? '').trim();
      const hasPacker = Boolean(String(row[5] ?? '').trim());
      const crossDay = String(row[21] ?? '').trim() === 'ใช่' ? 1 : 0;
      allOrderRows.push([...row, date.slice(0, 10), hasAdmin ? 1 : 0, status === 'Success' ? 1 : 0, hasAdmin && !hasPacker ? 1 : 0, crossDay, date.slice(0, 7)]);
    }
  }
  const allOrdersHeaders = [...ALL_HEADERS, 'Source Sheet', 'Admin Flag', 'Packed Flag', 'Pending Flag', 'Cross-day Flag', 'Month'];
  if (shouldBuildAllOrders) {
    await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('All Orders!A1:AC5000')}:clear`, token, {
      method: 'POST', body: JSON.stringify({}),
    });
    await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('All Orders!A1:AC5000')}?valueInputOption=USER_ENTERED`, token, {
      method: 'PUT', body: JSON.stringify({ values: [allOrdersHeaders, ...allOrderRows] }),
    });
  }
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!A1:H8')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [
      ['สรุปการสแกน', '', '', '', '', '', '', ''],
      ['เลือกวันที่', dateList[0], '', '', '', '', '', ''],
      ['รายการแอดมินสแกน', `=COUNTIF(INDIRECT("'"&B2&"'!L2:L"),"<>")`, '', 'แพ็คแล้ว', `=COUNTIF(INDIRECT("'"&B2&"'!I2:I"),"Success")`, '', 'รอแพ็ค', `=COUNTIF(INDIRECT("'"&B2&"'!I2:I"),"รอแพ็ค")`],
      ['ข้ามวัน', `=COUNTIF(INDIRECT("'"&B2&"'!V2:V"),"ใช่")`, '', 'อัปเดตล่าสุด', new Date().toISOString(), '', '', ''],
      ['วันที่ในระบบ', ...dateList],
    ] }),
  }).catch((error) => {
    console.warn('Legacy Dashboard formulas skipped:', error);
  });
  let dashboardRows = [];
  for (const date of dateSheets) {
    const rows = await readDailyRows({ token, spreadsheetId, date }).catch((error) => {
      console.warn(`Dashboard read failed for ${date}:`, error);
      return [];
    });
    dashboardRows.push([
      date,
      rows.filter((row) => String(row[11] ?? '').trim()).length,
      rows.filter((row) => String(row[8] ?? '').trim() === 'Success').length,
      rows.filter((row) => String(row[8] ?? '').trim() === 'รอแพ็ค').length,
      rows.filter((row) => String(row[21] ?? '').trim() === 'ใช่').length,
    ]);
  }
  const dailyMap = new Map();
  for (const [date, admin, shipped, pending, crossDay] of dashboardRows) {
    const key = date.slice(0, 10);
    const stats = dailyMap.get(key) ?? [0, 0, 0, 0];
    stats[0] += admin;
    stats[1] += shipped;
    stats[2] += pending;
    stats[3] += crossDay;
    dailyMap.set(key, stats);
  }
  dashboardRows = [...dailyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, stats]) => [date, ...stats]);
  const monthlyMap = new Map();
  for (const [date, ...stats] of dashboardRows) {
    const month = date.slice(0, 7);
    const total = monthlyMap.get(month) ?? [0, 0, 0, 0];
    stats.forEach((value, index) => { total[index] += value; });
    monthlyMap.set(month, total);
  }
  const monthlyRows = [...monthlyMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, stats]) => [month, ...stats]);
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!A10:E100')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [['วันที่', 'แอดมินสแกน', 'แพ็คแล้ว', 'รอแพ็ค', 'ข้ามวัน'], ...dashboardRows] }),
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!A1:E100')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [['วันที่', 'แอดมินสแกน', 'แพ็คแล้ว', 'รอแพ็ค', 'ข้ามวัน'], ...dashboardRows] }),
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!G1:K100')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [['เดือน', 'แอดมินสแกน', 'แพ็คแล้ว', 'รอแพ็ค', 'ข้ามวัน'], ...monthlyRows] }),
  });
  const todayStats = dailyMap.get(today) ?? [0, 0, 0, 0];
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!A1:E5')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [
      ['Dashboard Summary', '', '', '', ''],
      ['Last sync', new Date().toISOString(), '', '', ''],
      ['Today', today, '', '', ''],
      ['Admin scans', todayStats[0], 'Packed', todayStats[1], ''],
      ['Pending pack', todayStats[2], 'Cross-day', todayStats[3], 'Packed count uses packer scan date'],
    ] }),
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!A7:E100')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [['Daily summary', '', '', '', ''], ['Date', 'Admin scans', 'Packed', 'Pending', 'Cross-day'], ...dashboardRows] }),
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!G7:K100')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [['Monthly summary', '', '', '', ''], ['Month', 'Admin scans', 'Packed', 'Pending', 'Cross-day'], ...monthlyRows] }),
  });
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!A8:E15')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [[
      '=QUERY(\'All Orders\'!A:AC,"select X,sum(Y),sum(Z),sum(AA),sum(AB) where X is not null group by X order by X desc limit 7 label X \'Date\',sum(Y) \'Admin scans\',sum(Z) \'Packed\',sum(AA) \'Pending\',sum(AB) \'Cross-day\'",1)', '', '', '', ''],
    ] }),
  }).catch((error) => console.warn('Daily Dashboard formula skipped:', error));
  await apiFetch(`${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent('Dashboard!G8:K20')}?valueInputOption=USER_ENTERED`, token, {
    method: 'PUT', body: JSON.stringify({ values: [[
      '=QUERY(\'All Orders\'!A:AC,"select AC,sum(Y),sum(Z),sum(AA),sum(AB) where AC is not null group by AC order by AC desc label AC \'Month\',sum(Y) \'Admin scans\',sum(Z) \'Packed\',sum(AA) \'Pending\',sum(AB) \'Cross-day\'",1)', '', '', '', ''],
    ] }),
  }).catch((error) => console.warn('Monthly Dashboard formula skipped:', error));
  await apiFetch(`${SHEETS_API}/${spreadsheetId}:batchUpdate`, token, { method: 'POST', body: JSON.stringify({ requests: [
    { updateSheetProperties: { properties: { sheetId: dashboard.sheetId, index: 0 }, fields: 'index' } },
    { updateSheetProperties: { properties: { sheetId: audit.sheetId, index: 1 }, fields: 'index' } },
  ] }) });
}

export async function ensureGoogleSheetOrganization({ token, config, today = getBangkokParts().date }) {
  if (config?.master?.id) await ensureManagementSheets({ token, spreadsheetId: config.master.id, today });
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
    `${SHEETS_API}/${spreadsheetId}/values/${encodeURIComponent(`${date}!A1:${sheetEndColumn()}1`)}?valueInputOption=RAW`,
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
        ...buildStatusFormattingRequests(sheetId),
      ],
    }),
  });
  await applyStatusCellColors({ token, spreadsheetId, date, sheetId });
}

async function applyStatusCellColors({ token, spreadsheetId, date, sheetId }) {
  const rows = await readDailyRows({ token, spreadsheetId, date });
  const requests = [];
  const colors = {
    success: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.88 }, foregroundColor: { red: 0.1, green: 0.45, blue: 0.2 } },
    pending: { backgroundColor: { red: 1, green: 0.95, blue: 0.75 }, foregroundColor: { red: 0.55, green: 0.35, blue: 0 } },
    overdue: { backgroundColor: { red: 0.98, green: 0.82, blue: 0.82 }, foregroundColor: { red: 0.65, green: 0.05, blue: 0.05 } },
    crossDay: { backgroundColor: { red: 1, green: 0.9, blue: 0.75 }, foregroundColor: { red: 0.65, green: 0.35, blue: 0 } },
  };
  rows.slice(0, 500).forEach((row, index) => {
    const status = String(row[8] ?? '').trim();
    const hasPacker = Boolean(String(row[5] ?? '').trim());
    const hasAdmin = Boolean(String(row[12] ?? '').trim());
    const scanDate = String(row[2] ?? '').trim();
    const adminDate = String(row[10] ?? '').trim();
    const adminAt = hasAdmin ? parseDateTime(adminDate, String(row[11] ?? '').trim()) : null;
    const overdue = hasAdmin && !hasPacker && adminAt
      && Date.now() - adminAt.getTime() >= 24 * 60 * 60 * 1000;
    const style = status === 'Success'
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
    rule(orderStatusRange, '=$U2="ส่งออกแล้ว"', { red: 0.85, green: 0.95, blue: 0.88 }, { red: 0.1, green: 0.45, blue: 0.2 }),
    rule(orderStatusRange, '=$U2="รอแพ็ค"', { red: 1, green: 0.95, blue: 0.75 }, { red: 0.55, green: 0.35, blue: 0 }),
    rule(orderStatusRange, '=$U2="รอแพ็คเกิน 1 วัน"', { red: 0.98, green: 0.82, blue: 0.82 }, { red: 0.65, green: 0.05, blue: 0.05 }, true),
    rule(crossDayRange, '=$V2="ใช่"', { red: 1, green: 0.9, blue: 0.75 }, { red: 0.65, green: 0.35, blue: 0 }),
  ];
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

async function updateDailyRow({ token, spreadsheetId, date, rowNumber, row }) {
  const range = `${escapeSheetName(date)}!A${rowNumber}:${sheetEndColumn()}${rowNumber}`;
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
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const sheetId = spreadsheet.sheets?.find((sheet) => sheet.properties.title === date)?.properties.sheetId;
  if (sheetId) await applyStatusCellColors({ token, spreadsheetId, date, sheetId });
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
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const dateSheets = (spreadsheet.sheets ?? [])
    .map((item) => item.properties)
    .filter((properties) => /^\d{4}-\d{2}-\d{2}(?:_conflict\d+)?$/.test(properties.title));
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

export async function fetchTodaySummary({ token, config }) {
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
  const parsedRows = (await Promise.all(sheetDates.map(async (sheetDate) => {
    const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date: sheetDate });
    return rows.map(rowFromSheet);
  }))).flat();
  const shippedRows = parsedRows.filter((row) => row.status === 'Success' && row.date === date);

  const courierCounts = COURIERS.map((courier) => ({
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

export async function getScanReportGoogle({ token, config, dates }) {
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
        couriers: COURIERS.map((courier) => ({ courier, count: 0 })),
      },
    ]),
  );
  const courierTotals = COURIERS.map((courier) => ({ courier, count: 0 }));
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

  for (const sheetDate of sheetTitles) {
    const rows = (await readDailyRows({ token, spreadsheetId: sheet.id, date: sheetDate })).map(rowFromSheet);
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
  const rows = [];

  for (const date of [...new Set(dates)].filter(Boolean).sort()) {
    if (!sheetTitles.has(date)) {
      continue;
    }

    const dailyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    rows.push(
      ...dailyRows
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
export async function appendScanGoogle({ token, config, courier, code, email, packer = '', note = '', marketplaceOrder = null }) {
  const normalizedCode = normalizeScanCode(code);
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

  // If packer scans a code that admin already put in column M, merge into that row
  if (!duplicate && !isCancelled) {
    const adminMatchRow = parsedRows.find(
      (row) => normalizeScanCode(row.adminCode) === normalizeScanCode(normalizedCode) && row.courier === courier,
    );
    if (adminMatchRow) {
      const rowNumber = adminMatchRow.sheetRowNumber;
      // Re-read to get fresh row position
      const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
      const verifyParsed = verifyRows.map(rowFromSheet);
      const targetIdx = verifyParsed.findIndex(
        (row) => normalizeScanCode(row.adminCode) === normalizeScanCode(normalizedCode) && row.courier === courier,
      );
      if (targetIdx === -1) {
        // Row was deleted, fall through to normal append
      } else {
        const currentRow = verifyParsed[targetIdx];
        const targetRowNumber = targetIdx + 2;
        // Calculate Courier No. for this courier's existing rows + 1
        const existingCourierRows = verifyParsed.filter(
          (r) => r.courier === courier && r.code && r.code.trim() !== '',
        );
        const adminOnlyCourierRows = verifyParsed.filter(
          (r) => r.courier === courier && String(r.no) !== String(currentRow.no),
        );
        const courierNo = existingCourierRows.length + 1;
        const overallNo = targetIdx + 1;

        const mergedRow = withMarketplaceCells([
          overallNo,
          courierNo,
          currentRow.adminDate || currentRow.date || date,
          time,
          courier,
          normalizedCode,
          email,
          packer,
          'Success',
          note,
          currentRow.adminDate || date,
          currentRow.adminTime || time,
          currentRow.adminCode || normalizedCode,
        ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

        await updateDailyRow({
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
          .filter((row) => row.courier === courier)
          .reverse()
          .slice(0, 20);

        return {
          status: 'success',
          courier,
          date,
          time,
          code: normalizedCode,
          count: courierNo,
          row: rowFromSheet(mergedRow),
          rows: resultRows,
          sheetUrl: sheet.webViewLink,
          merged: true,
        };
      }
    }

    const crossDayMatch = await findRowsAcrossDays({ token, spreadsheetId: sheet.id, currentDate: date, courier, code: normalizedCode, field: 'adminCode' });
    if (crossDayMatch) {
      const currentRow = crossDayMatch.row;
      const mergedRow = withMarketplaceCells([
        currentRow.no, currentRow.courierNo, date, time, courier, normalizedCode, email, packer,
        'Success', note, currentRow.adminDate || crossDayMatch.date, currentRow.adminTime || '', currentRow.adminCode || normalizedCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
      await updateDailyRow({ token, spreadsheetId: sheet.id, date: crossDayMatch.date, rowNumber: currentRow.sheetRowNumber, row: mergedRow });
      return { status: 'success', courier, date, time, code: normalizedCode, rows: crossDayMatch.parsedRows.filter((row) => row.courier === courier).reverse().slice(0, 20), sheetUrl: sheet.webViewLink, merged: true, crossDay: true };
    }
  }

  if (!duplicate && !isCancelled) {
    const adminMatchAnyCourier = await findRowsAcrossDays({
      token,
      spreadsheetId: sheet.id,
      currentDate: date,
      code: normalizedCode,
      field: 'adminCode',
    });
    if (adminMatchAnyCourier && adminMatchAnyCourier.row.courier !== courier) {
      const currentRow = adminMatchAnyCourier.row;
      const correctedNote = [currentRow.note, `แพ็คเกอร์เลือกขนส่งไม่ตรงกับแอดมิน (เลือก ${courier})`].filter(Boolean).join(' | ');
      const mergedRow = withMarketplaceCells([
        currentRow.no, currentRow.courierNo, date, time, currentRow.courier, normalizedCode, email, packer,
        'Success', correctedNote, currentRow.adminDate || adminMatchAnyCourier.date, currentRow.adminTime || '', currentRow.adminCode || normalizedCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
      await updateDailyRow({ token, spreadsheetId: sheet.id, date: adminMatchAnyCourier.date, rowNumber: currentRow.sheetRowNumber, row: mergedRow });
      return {
        status: 'success', courier: currentRow.courier, selectedCourier: courier, date, time, code: normalizedCode,
        rows: adminMatchAnyCourier.parsedRows.filter((row) => row.courier === currentRow.courier).reverse().slice(0, 20),
        sheetUrl: sheet.webViewLink, merged: true, wrongCourier: true, crossDay: adminMatchAnyCourier.date !== date,
      };
    }
  }

  if (duplicateRow && isCancelled) {
    const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    const verifyParsed = verifyRows.map(rowFromSheet);
    const verifyCourierRows = verifyParsed.filter((row) => row.courier === courier);
    const verifyIdx = verifyCourierRows.findIndex(
      (row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
    );

    if (verifyIdx !== -1) {
      const currentRow = verifyCourierRows[verifyIdx];
      const globalIdx = verifyParsed.findIndex(
        (row) =>
          row.courier === courier &&
          normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
      );
      const rowNumber = globalIdx + 2;

      const updatedRow = withMarketplaceCells([
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
        currentRow.adminDate || '',
        currentRow.adminTime || '',
        currentRow.adminCode || '',
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

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
    isCancelled ? 'Cancelled' : 'Success',
    note,
    '',
    '',
    '',
  ], marketplaceOrder);

  const range = `${escapeSheetName(date)}!A:${sheetEndColumn()}`;
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

  const updatedRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const updatedParsedRows = updatedRows.map((row, idx) => rowFromSheet(row, idx));
  const insertedIdx = updatedParsedRows.findIndex((row) => String(row.no) === placeholder);

  if (insertedIdx === -1) {
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

  const concurrentCodes = updatedCourierRows.filter(
    (row) => normalizeScanCode(row.code) === normalizeScanCode(normalizedCode),
  );

  const concurrentDuplicate = concurrentCodes.length > 1;

  const correctNo = insertedIdx + 1;
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
    concurrentDuplicate ? 'Duplicate' : isCancelled ? 'Cancelled' : 'Success',
    concurrentDuplicate ? 'Duplicate (concurrent scan)' : note,
    '',
    '',
    '',
  ], marketplaceOrder);

  await updateDailyRow({
    token,
    spreadsheetId: sheet.id,
    date,
    rowNumber: insertedIdx + 2,
    row: correctedRow,
  });

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
}

/**
 * appendAdminScanGoogle
 * Admin "down Drive" scan — saves tracking number into columns K, L, M.
 * If packer already scanned this code (column F), merge admin data into that row.
 */
export async function appendAdminScanGoogle({ token, config, courier, code, email, marketplaceOrder = null }) {
  const normalizedCode = normalizeScanCode(code);
  const sheet = config?.master;
  if (!sheet?.id) {
    throw new Error('ไม่พบ Google Sheet Master');
  }

  const { date, time } = getBangkokParts();
  await ensureDailyWorksheet({ token, spreadsheetId: sheet.id, date });
  const rows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const parsedRows = rows.map(rowFromSheet);

  // 1) Check if admin already saved this code (duplicate admin scan)
  const adminDuplicate = parsedRows.find(
    (row) => normalizeScanCode(row.adminCode) === normalizedCode && row.courier === courier,
  );
  if (adminDuplicate) {
    return {
      status: 'duplicate',
      courier,
      date,
      time,
      code: normalizedCode,
      rows: parsedRows.filter((r) => r.courier === courier).reverse().slice(0, 20),
      sheetUrl: sheet.webViewLink,
    };
  }

  // 2) Check if packer already scanned this code (column F)
  const packerRow = parsedRows.find(
    (row) => normalizeScanCode(row.code) === normalizedCode && row.courier === courier,
  );

  if (packerRow) {
    // Merge: update existing row with admin fields
    const rowNumber = packerRow.sheetRowNumber;
    // Re-read for fresh position
    const verifyRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
    const verifyParsed = verifyRows.map(rowFromSheet);
    const targetIdx = verifyParsed.findIndex(
      (row) => normalizeScanCode(row.code) === normalizedCode && row.courier === courier,
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
        date,
        time,
        normalizedCode,
      ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));

      await updateDailyRow({
        token,
        spreadsheetId: sheet.id,
        date,
        rowNumber: targetIdx + 2,
        row: mergedRow,
      });

      const resultRows = verifyParsed
        .filter((r) => r.courier === courier)
        .reverse()
        .slice(0, 20);

      return {
        status: 'admin_matched',
        courier,
        date,
        time,
        code: normalizedCode,
        rows: resultRows,
        sheetUrl: sheet.webViewLink,
      };
    }
  }

  const crossDayMatch = await findRowsAcrossDays({ token, spreadsheetId: sheet.id, currentDate: date, courier, code: normalizedCode, field: 'code' });
  if (crossDayMatch) {
    const currentRow = crossDayMatch.row;
    const mergedRow = withMarketplaceCells([
      currentRow.no, currentRow.courierNo, currentRow.date, currentRow.time, currentRow.courier, currentRow.code,
      currentRow.email, currentRow.packer, currentRow.status || 'Success', currentRow.note || '', date, time, normalizedCode,
    ], marketplaceOrder ?? marketplaceOrderFromRow(currentRow));
    await updateDailyRow({ token, spreadsheetId: sheet.id, date: crossDayMatch.date, rowNumber: currentRow.sheetRowNumber, row: mergedRow });
    return { status: 'admin_matched', courier, date, time, code: normalizedCode, rows: crossDayMatch.parsedRows.filter((row) => row.courier === courier).reverse().slice(0, 20), sheetUrl: sheet.webViewLink, crossDay: true };
  }

  // 3) New admin-only row — append with placeholder
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
    date,
    time,
    normalizedCode,
  ], marketplaceOrder);

  const range = `${escapeSheetName(date)}!A:${sheetEndColumn()}`;
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

  const updatedRows = await readDailyRows({ token, spreadsheetId: sheet.id, date });
  const updatedParsedRows = updatedRows.map((row, idx) => rowFromSheet(row, idx));
  const insertedIdx = updatedParsedRows.findIndex((row) => String(row.no) === placeholder);

  const correctNo = insertedIdx >= 0 ? insertedIdx + 1 : updatedParsedRows.length + 1;
  const courierAdminCount = updatedParsedRows.filter(
    (r) => r.courier === courier && r.adminCode && r.adminCode.trim() !== '',
  ).length + (insertedIdx >= 0 ? 1 : 0);
  const correctCourierNo = courierAdminCount;

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
    date,
    time,
    normalizedCode,
  ], marketplaceOrder);

  if (insertedIdx >= 0) {
    await updateDailyRow({
      token,
      spreadsheetId: sheet.id,
      date,
      rowNumber: insertedIdx + 2,
      row: correctedRow,
    });
  }

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
    const titleTime = d.getTime();
    // Include today and yesterday based on lookback
    return (now.getTime() - titleTime) <= lookbackMs;
  });

  const matched = [];
  const pending = [];
  const pendingOverOneDay = [];
  const tooSoon = [];
  const cancelled = [];
  const damaged = [];

  for (const date of relevantDates) {
    const rows = (await readDailyRows({ token, spreadsheetId: sheet.id, date })).map(rowFromSheet);

    for (const row of rows) {
      // Only consider rows that admin scanned
      if (!row.adminCode || row.adminCode.trim() === '') continue;

      // Filter by courier if specified
      if (courier && row.courier !== courier) continue;

      const adminTimeStr = row.adminTime || row.time || '00:00:00';
      const adminDateStr = row.adminDate || row.date || date;
      const adminDateTime = parseDateTime(adminDateStr, adminTimeStr);

      const isCancelled = row.status === 'Cancelled' || row.note === 'ลูกค้ายกเลิก';
      const isDamaged = row.status === 'Damaged' || row.note === 'สินค้าเสียหาย';

      if (isCancelled) {
        cancelled.push({ ...row, _sheetDate: date });
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
    damaged,
    totalAdminScans: matched.length + pending.length + tooSoon.length + cancelled.length + damaged.length,
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

async function findRowsAcrossDays({ token, spreadsheetId, currentDate, courier = null, code, field }) {
  const normalizedCode = normalizeScanCode(code);
  const spreadsheet = await getSpreadsheet(token, spreadsheetId);
  const titles = new Set((spreadsheet.sheets ?? []).map((item) => item.properties.title));
  for (const date of getLookbackDates(currentDate)) {
    if (!titles.has(date)) continue;
    const rows = await readDailyRows({ token, spreadsheetId, date });
    const parsedRows = rows.map((row, index) => rowFromSheet(row, index));
    const match = parsedRows.find(
      (row) => (!courier || row.courier === courier) && normalizeScanCode(row[field]) === normalizedCode,
    );
    if (match) return { date, parsedRows, row: match };
  }
  return null;
}

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
  return d;
}
