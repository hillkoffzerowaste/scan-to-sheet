function cleanCell(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\t+$/g, '').trim();
}

function normalizeHeader(value) {
  return cleanCell(value).toLowerCase().replace(/[\s_-]+/g, '');
}

function firstHeaderIndex(headers, candidates) {
  return headers.findIndex((header) => candidates.some((candidate) => (
    header.includes(candidate) || normalizeHeader(header).includes(normalizeHeader(candidate))
  )));
}

const SCIENTIFIC_NOTATION = /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i;

export function shouldRunMarketplaceBackfill({ trigger, sessionReady = false } = {}) {
  return sessionReady === true && trigger === 'manual';
}

export function validateMarketplaceIdentifier(value, { platform, rowNumber, field }) {
  const text = cleanCell(value);
  const unsafeExcelNumber = typeof value === 'number'
    && (!Number.isSafeInteger(value) || Math.abs(value) >= 1_000_000_000_000_000);
  if (!unsafeExcelNumber && !SCIENTIFIC_NOTATION.test(text)) return text;
  throw new Error(
    `ไฟล์ ${platform} แถว ${rowNumber} ช่อง ${field} มีเลขยาวที่ Excel ปัดค่าเป็น "${text}" กรุณาตั้งคอลัมน์นี้เป็น Text แล้วดาวน์โหลดไฟล์ใหม่`,
  );
}

export function normalizeMarketplaceTracking(value) {
  return cleanCell(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const MONTH_ABBR = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Rejects out-of-range components instead of emitting a string that still sorts.
// A bogus value like month 27 would otherwise sort above every real date.
function formatOrderTimestamp({ year, month, day, hour, minute, second }) {
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second ?? 0);
  const inRange = Number.isInteger(y) && y >= 1970 && y <= 9999
    && mo >= 1 && mo <= 12
    && d >= 1 && d <= 31
    && h >= 0 && h <= 23
    && mi >= 0 && mi <= 59
    && s >= 0 && s <= 59;
  if (!inRange) return '';
  const pad = (part) => String(part).padStart(2, '0');
  return `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;
}

// Converts the assorted per-platform order-date formats (TikTok "27/07/2026 20:33:12",
// Lazada "27 Jul 2026 21:18", Shopee "2026-07-26 00:06") into a single "YYYY-MM-DD HH:mm:ss"
// string so orders can be sorted latest-first regardless of source platform.
export function normalizeMarketplaceOrderDate(value) {
  const text = cleanCell(value);
  if (!text) return '';

  const isoMatch = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoMatch) {
    return formatOrderTimestamp({
      year: isoMatch[1], month: isoMatch[2], day: isoMatch[3],
      hour: isoMatch[4], minute: isoMatch[5], second: isoMatch[6],
    });
  }

  const slashMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (slashMatch) {
    let day = Number(slashMatch[1]);
    let month = Number(slashMatch[2]);
    // Seller exports use D/M/Y in most locales but M/D/Y in US ones. When the second
    // component cannot be a month the export must be M/D/Y, so swap the pair.
    if (month > 12 && day <= 12) [day, month] = [month, day];
    return formatOrderTimestamp({
      year: slashMatch[3], month, day,
      hour: slashMatch[4], minute: slashMatch[5], second: slashMatch[6],
    });
  }

  const monthNameMatch = text.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (monthNameMatch) {
    return formatOrderTimestamp({
      year: monthNameMatch[3],
      month: MONTH_ABBR[monthNameMatch[2].slice(0, 3).toLowerCase()],
      day: monthNameMatch[1],
      hour: monthNameMatch[4], minute: monthNameMatch[5], second: monthNameMatch[6],
    });
  }

  // Never return unrecognized text: it would sort above every ISO timestamp and let
  // one unparseable row monopolize the import window instead of being flagged missing.
  return '';
}

export function parseCsvText(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      row.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(value);
      if (row.some((cell) => cleanCell(cell))) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((cell) => cleanCell(cell))) rows.push(row);
  return rows;
}

export function parseMarketplaceRows(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map((value) => cleanCell(value));
  const lowerHeaders = headers.map((value) => value.toLowerCase());
  let platform = '';
  let orderHeader = '';
  let skuHeader = '';
  let trackingHeader = '';
  let statusHeader = '';
  let expectedShipHeader = '';
  let orderDateHeader = '';
  const itemNameIndex = firstHeaderIndex(lowerHeaders, [
    'product name', 'item name', 'product title', 'item title', 'product description',
    'ชื่อสินค้า', 'ชื่อผลิตภัณฑ์', 'ชื่อรายการ',
  ]);
  const quantityIndex = firstHeaderIndex(lowerHeaders, ['quantity', 'qty', 'จำนวน']);

  if (lowerHeaders.includes('ordernumber')) {
    platform = 'lazada';
    orderHeader = 'ordernumber';
    skuHeader = 'sellersku';
    trackingHeader = 'trackingcode';
    orderDateHeader = 'createtime';
  } else if (headers.includes('หมายเลขคำสั่งซื้อ')) {
    platform = 'shopee';
    orderHeader = 'หมายเลขคำสั่งซื้อ';
    skuHeader = 'เลขอ้างอิง sku (sku reference no.)';
    trackingHeader = '*หมายเลขติดตามพัสดุ';
    statusHeader = 'สถานะการสั่งซื้อ';
    expectedShipHeader = 'วันที่คาดว่าจะทำการจัดส่งสินค้า';
    orderDateHeader = 'วันที่ทำการสั่งซื้อ';
  } else if (lowerHeaders.includes('order id')) {
    platform = 'tiktok';
    orderHeader = 'order id';
    skuHeader = 'seller sku';
    trackingHeader = 'tracking id';
    orderDateHeader = 'created time';
  } else {
    throw new Error('ไม่พบรูปแบบไฟล์ Shopee, Lazada หรือ TikTok');
  }

  const orderIndex = lowerHeaders.indexOf(orderHeader);
  const skuIndex = lowerHeaders.indexOf(skuHeader);
  const trackingIndex = lowerHeaders.indexOf(trackingHeader);
  const statusIndex = statusHeader ? lowerHeaders.indexOf(statusHeader) : -1;
  const expectedShipIndex = expectedShipHeader ? lowerHeaders.indexOf(expectedShipHeader) : -1;
  const orderDateIndex = orderDateHeader ? lowerHeaders.indexOf(orderDateHeader) : -1;
  if ([orderIndex, skuIndex, trackingIndex].some((index) => index < 0)) {
    throw new Error(`ไฟล์ ${platform} ขาดคอลัมน์เลขคำสั่งซื้อ, SKU หรือเลขพัสดุ`);
  }

  return rows.slice(1).map((row, index) => ({
    platform,
    orderId: validateMarketplaceIdentifier(row[orderIndex], {
      platform, rowNumber: index + 2, field: 'เลขคำสั่งซื้อ',
    }),
    sku: validateMarketplaceIdentifier(row[skuIndex], {
      platform, rowNumber: index + 2, field: 'SKU',
    }),
    itemName: itemNameIndex >= 0 ? cleanCell(row[itemNameIndex]) : '',
    quantity: quantityIndex >= 0 ? cleanCell(row[quantityIndex]) : '',
    trackingNo: validateMarketplaceIdentifier(row[trackingIndex], {
      platform, rowNumber: index + 2, field: 'เลขพัสดุ',
    }),
    sellerOrderStatus: statusIndex >= 0 ? cleanCell(row[statusIndex]) : '',
    expectedShipAt: expectedShipIndex >= 0 ? cleanCell(row[expectedShipIndex]) : '',
    orderedAt: orderDateIndex >= 0 ? normalizeMarketplaceOrderDate(row[orderDateIndex]) : '',
  })).filter((row) => (
    row.orderId
    && (row.trackingNo || row.sku)
    && row.orderId.toLowerCase() !== 'platform unique order id.'
    && (!row.trackingNo || row.trackingNo.toLowerCase() !== "the order's tracking number.")
  ));
}

export function groupMarketplaceRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const normalizedTrackingNo = normalizeMarketplaceTracking(row.trackingNo);
    const key = `${row.platform}__${row.orderId}__${normalizedTrackingNo}`;
    const current = groups.get(key) ?? {
      platform: row.platform,
      orderId: cleanCell(row.orderId),
      trackingNo: cleanCell(row.trackingNo),
      normalizedTrackingNo,
      marketplaceSkus: [],
      items: [],
      sourceRowCount: 0,
      sellerOrderStatus: cleanCell(row.sellerOrderStatus),
      expectedShipAt: cleanCell(row.expectedShipAt),
      orderedAt: cleanCell(row.orderedAt),
    };
    current.sourceRowCount += 1;
    if (!current.sellerOrderStatus) current.sellerOrderStatus = cleanCell(row.sellerOrderStatus);
    if (!current.expectedShipAt) current.expectedShipAt = cleanCell(row.expectedShipAt);
    if (!current.orderedAt) current.orderedAt = cleanCell(row.orderedAt);
    const sku = cleanCell(row.sku);
    if (sku && !current.marketplaceSkus.includes(sku)) current.marketplaceSkus.push(sku);
    const item = {
      name: cleanCell(row.itemName),
      sku,
      quantity: Number(row.quantity) || '',
    };
    if ((item.name || item.sku) && !current.items.some((existing) => (
      existing.name === item.name && existing.sku === item.sku
    ))) {
      current.items.push(item);
    }
    groups.set(key, current);
  }
  return [...groups.values()];
}

function bangkokDateTime(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}`;
}

export function classifyLateOrder(order, now = new Date()) {
  if (order.scanned) return { key: 'scanned', label: 'สแกนแล้ว', color: 'green' };
  const expected = cleanCell(order.expectedShipAt).replace('T', ' ').slice(0, 16);
  if (!expected) return { key: 'unknown', label: 'ไม่พบกำหนดส่ง', color: 'neutral' };
  const current = bangkokDateTime(now);
  if (expected < current) return { key: 'overdue', label: 'ล่าช้า', color: 'red' };
  if (expected.slice(0, 10) === current.slice(0, 10)) {
    return { key: 'due_today', label: 'ครบกำหนดวันนี้', color: 'orange' };
  }
  return { key: 'future', label: 'รอดำเนินการ', color: 'neutral' };
}

export function isCompleteScanOrder(order) {
  if (!order || typeof order !== 'object') return false;
  return order.status === 'matched'
    || Boolean(order.admin?.scannedAt && order.packerScan?.scannedAt);
}

export function marketplaceMetadataChanged(existing, incoming) {
  if (!existing || !incoming) return true;
  const sameSkus = Array.isArray(existing.marketplaceSkus)
    && Array.isArray(incoming.marketplaceSkus)
    && existing.marketplaceSkus.length === incoming.marketplaceSkus.length
    && existing.marketplaceSkus.every((value, index) => value === incoming.marketplaceSkus[index]);
  const sameItems = JSON.stringify(Array.isArray(existing.items) ? existing.items : [])
    === JSON.stringify(Array.isArray(incoming.items) ? incoming.items : []);
  return String(existing.trackingNo ?? '') !== String(incoming.trackingNo ?? '')
    || String(existing.normalizedTrackingNo ?? '') !== String(incoming.normalizedTrackingNo ?? '')
    || !sameSkus
    || !sameItems
    || String(existing.sourceRowCount ?? '') !== String(incoming.sourceRowCount ?? '')
    || String(existing.sellerOrderStatus ?? '') !== String(incoming.sellerOrderStatus ?? '')
    || String(existing.expectedShipAt ?? '') !== String(incoming.expectedShipAt ?? '')
    || existing.importSource !== 'web_upload';
}

export function buildSheetBackfillUpdates(sheetName, rows, groups) {
  const groupsByTracking = new Map();
  const groupsByPlatformTracking = new Map();
  const blankTrackingGroupsByPlatformOrderId = new Map();
  groups.forEach((group) => {
    const platform = cleanCell(group.platform).toLowerCase();
    const normalizedTrackingNo = normalizeMarketplaceTracking(group.normalizedTrackingNo ?? group.trackingNo);
    const orderId = cleanCell(group.orderId);
    if (normalizedTrackingNo) {
      const trackingMatches = groupsByTracking.get(normalizedTrackingNo) ?? [];
      trackingMatches.push(group);
      groupsByTracking.set(normalizedTrackingNo, trackingMatches);

      const platformTrackingKey = `${platform}__${normalizedTrackingNo}`;
      const platformTrackingMatches = groupsByPlatformTracking.get(platformTrackingKey) ?? [];
      platformTrackingMatches.push(group);
      groupsByPlatformTracking.set(platformTrackingKey, platformTrackingMatches);
      return;
    }
    if (!platform || !orderId) return;
    const platformOrderKey = `${platform}__${orderId}`;
    const orderMatches = blankTrackingGroupsByPlatformOrderId.get(platformOrderKey) ?? [];
    orderMatches.push(group);
    blankTrackingGroupsByPlatformOrderId.set(platformOrderKey, orderMatches);
  });
  const escapedSheet = `'${String(sheetName).replace(/'/g, "''")}'`;
  const data = [];
  let matchedRows = 0;
  rows.forEach((row, index) => {
    const platform = cleanCell(row[13]).toLowerCase();
    const sheetTrackings = [...new Set([
      normalizeMarketplaceTracking(row[5]),
      normalizeMarketplaceTracking(row[12]),
    ].filter(Boolean))];
    const trackingCandidates = sheetTrackings.flatMap((trackingNo) => (
      platform
        ? groupsByPlatformTracking.get(`${platform}__${trackingNo}`) ?? []
        : groupsByTracking.get(trackingNo) ?? []
    ));
    const uniqueTrackingCandidates = [...new Set(trackingCandidates)];
    const trackingMatch = uniqueTrackingCandidates.length === 1 ? uniqueTrackingCandidates[0] : null;
    const orderId = cleanCell(row[14]);
    const orderIdMatches = platform && orderId
      ? blankTrackingGroupsByPlatformOrderId.get(`${platform}__${orderId}`) ?? []
      : [];
    // Fall back only for exports whose tracking is blank. A nonblank imported
    // tracking that differs from the sheet must never copy data onto that row.
    const group = trackingMatch
      ?? (orderIdMatches.length === 1 ? orderIdMatches[0] : null);
    if (!group) return;
    const rowNumber = index + 2;
    const skuText = group.marketplaceSkus.join(' | ');
    const itemText = (Array.isArray(group.items) ? group.items : [])
      .map((item) => `${cleanCell(item?.name)}${item?.quantity ? ` x${item.quantity}` : ''}`.trim())
      .filter(Boolean)
      .join(' | ');
    const itemQty = group.platform?.toLowerCase() === 'lazada'
      ? Number(group.sourceRowCount) || ''
      : (Array.isArray(group.items) ? group.items : [])
        .reduce((total, item) => total + (Number(item?.quantity) || 0), 0) || '';
    if (String(row[13] ?? '') !== group.platform) data.push({ range: `${escapedSheet}!N${rowNumber}`, values: [[group.platform]] });
    if (String(row[14] ?? '') !== group.orderId) data.push({ range: `${escapedSheet}!O${rowNumber}`, values: [[group.orderId]] });
    if (itemText && String(row[16] ?? '') !== itemText) data.push({ range: `${escapedSheet}!Q${rowNumber}`, values: [[itemText]] });
    if (String(row[17] ?? '') !== skuText) data.push({ range: `${escapedSheet}!R${rowNumber}`, values: [[skuText]] });
    if (itemQty && String(row[18] ?? '') !== String(itemQty)) data.push({ range: `${escapedSheet}!S${rowNumber}`, values: [[itemQty]] });
    matchedRows += 1;
  });
  return { data, matchedRows };
}
