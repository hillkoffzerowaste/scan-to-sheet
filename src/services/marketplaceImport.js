function cleanCell(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\t+$/g, '').trim();
}

const SCIENTIFIC_NOTATION = /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i;

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

  if (lowerHeaders.includes('ordernumber')) {
    platform = 'lazada';
    orderHeader = 'ordernumber';
    skuHeader = 'sellersku';
    trackingHeader = 'trackingcode';
  } else if (headers.includes('หมายเลขคำสั่งซื้อ')) {
    platform = 'shopee';
    orderHeader = 'หมายเลขคำสั่งซื้อ';
    skuHeader = 'เลขอ้างอิง sku (sku reference no.)';
    trackingHeader = '*หมายเลขติดตามพัสดุ';
    statusHeader = 'สถานะการสั่งซื้อ';
    expectedShipHeader = 'วันที่คาดว่าจะทำการจัดส่งสินค้า';
  } else if (lowerHeaders.includes('order id')) {
    platform = 'tiktok';
    orderHeader = 'order id';
    skuHeader = 'seller sku';
    trackingHeader = 'tracking id';
  } else {
    throw new Error('ไม่พบรูปแบบไฟล์ Shopee, Lazada หรือ TikTok');
  }

  const orderIndex = lowerHeaders.indexOf(orderHeader);
  const skuIndex = lowerHeaders.indexOf(skuHeader);
  const trackingIndex = lowerHeaders.indexOf(trackingHeader);
  const statusIndex = statusHeader ? lowerHeaders.indexOf(statusHeader) : -1;
  const expectedShipIndex = expectedShipHeader ? lowerHeaders.indexOf(expectedShipHeader) : -1;
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
    trackingNo: validateMarketplaceIdentifier(row[trackingIndex], {
      platform, rowNumber: index + 2, field: 'เลขพัสดุ',
    }),
    sellerOrderStatus: statusIndex >= 0 ? cleanCell(row[statusIndex]) : '',
    expectedShipAt: expectedShipIndex >= 0 ? cleanCell(row[expectedShipIndex]) : '',
  })).filter((row) => (
    row.orderId
    && row.trackingNo
    && row.orderId.toLowerCase() !== 'platform unique order id.'
    && row.trackingNo.toLowerCase() !== "the order's tracking number."
  ));
}

export function groupMarketplaceRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const normalizedTrackingNo = normalizeMarketplaceTracking(row.trackingNo);
    if (!normalizedTrackingNo) continue;
    const key = `${row.platform}__${row.orderId}__${normalizedTrackingNo}`;
    const current = groups.get(key) ?? {
      platform: row.platform,
      orderId: cleanCell(row.orderId),
      trackingNo: cleanCell(row.trackingNo),
      normalizedTrackingNo,
      marketplaceSkus: [],
      sellerOrderStatus: cleanCell(row.sellerOrderStatus),
      expectedShipAt: cleanCell(row.expectedShipAt),
    };
    if (!current.sellerOrderStatus) current.sellerOrderStatus = cleanCell(row.sellerOrderStatus);
    if (!current.expectedShipAt) current.expectedShipAt = cleanCell(row.expectedShipAt);
    const sku = cleanCell(row.sku);
    if (sku && !current.marketplaceSkus.includes(sku)) current.marketplaceSkus.push(sku);
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
  return String(existing.trackingNo ?? '') !== String(incoming.trackingNo ?? '')
    || String(existing.normalizedTrackingNo ?? '') !== String(incoming.normalizedTrackingNo ?? '')
    || !sameSkus
    || String(existing.sellerOrderStatus ?? '') !== String(incoming.sellerOrderStatus ?? '')
    || String(existing.expectedShipAt ?? '') !== String(incoming.expectedShipAt ?? '')
    || existing.importSource !== 'web_upload';
}

export function buildSheetBackfillUpdates(sheetName, rows, groups) {
  const groupMap = new Map(groups.map((group) => [group.normalizedTrackingNo, group]));
  const groupsByOrderId = new Map();
  groups.forEach((group) => {
    const orderId = cleanCell(group.orderId);
    if (!orderId) return;
    const matches = groupsByOrderId.get(orderId) ?? [];
    matches.push(group);
    groupsByOrderId.set(orderId, matches);
  });
  const escapedSheet = `'${String(sheetName).replace(/'/g, "''")}'`;
  const data = [];
  let matchedRows = 0;
  rows.forEach((row, index) => {
    const trackingMatch = groupMap.get(normalizeMarketplaceTracking(row[5]))
      ?? groupMap.get(normalizeMarketplaceTracking(row[12]));
    const orderId = cleanCell(row[14]);
    const orderIdMatches = groupsByOrderId.get(orderId) ?? [];
    const platform = cleanCell(row[13]).toLowerCase();
    const platformMatches = platform
      ? orderIdMatches.filter((candidate) => candidate.platform === platform)
      : orderIdMatches;
    // Fall back to Order ID only where it identifies one imported order. A
    // single order can legitimately have several tracking numbers, so an
    // ambiguous Order ID must not copy an SKU onto the wrong sheet row.
    const group = trackingMatch
      ?? (platformMatches.length === 1 ? platformMatches[0] : null);
    if (!group) return;
    const rowNumber = index + 2;
    const skuText = group.marketplaceSkus.join(' | ');
    if (String(row[13] ?? '') !== group.platform) data.push({ range: `${escapedSheet}!N${rowNumber}`, values: [[group.platform]] });
    if (String(row[14] ?? '') !== group.orderId) data.push({ range: `${escapedSheet}!O${rowNumber}`, values: [[group.orderId]] });
    if (String(row[17] ?? '') !== skuText) data.push({ range: `${escapedSheet}!R${rowNumber}`, values: [[skuText]] });
    matchedRows += 1;
  });
  return { data, matchedRows };
}
