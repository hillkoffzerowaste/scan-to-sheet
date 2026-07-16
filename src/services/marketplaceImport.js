function cleanCell(value) {
  return String(value ?? '').replace(/^\uFEFF/, '').replace(/\t+$/g, '').trim();
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
  if ([orderIndex, skuIndex, trackingIndex].some((index) => index < 0)) {
    throw new Error(`ไฟล์ ${platform} ขาดคอลัมน์เลขคำสั่งซื้อ, SKU หรือเลขพัสดุ`);
  }

  return rows.slice(1).map((row) => ({
    platform,
    orderId: cleanCell(row[orderIndex]),
    sku: cleanCell(row[skuIndex]),
    trackingNo: cleanCell(row[trackingIndex]),
  })).filter((row) => row.orderId && row.trackingNo);
}

export function groupMarketplaceRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    const normalizedTrackingNo = cleanCell(row.trackingNo).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!normalizedTrackingNo) continue;
    const key = `${row.platform}__${row.orderId}__${normalizedTrackingNo}`;
    const current = groups.get(key) ?? {
      platform: row.platform,
      orderId: cleanCell(row.orderId),
      trackingNo: cleanCell(row.trackingNo),
      normalizedTrackingNo,
      marketplaceSkus: [],
    };
    const sku = cleanCell(row.sku);
    if (sku && !current.marketplaceSkus.includes(sku)) current.marketplaceSkus.push(sku);
    groups.set(key, current);
  }
  return [...groups.values()];
}
