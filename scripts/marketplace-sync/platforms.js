function textFromElement(element) {
  return (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
}

function collectCandidateRows() {
  const candidates = [
    '[data-testid*="order" i]',
    '[class*="order" i]',
    '[class*="Order" i]',
    '[class*="shipment" i]',
    '[class*="package" i]',
    'tr',
    'li',
  ];
  const seen = new Set();
  const rows = [];

  for (const selector of candidates) {
    for (const element of document.querySelectorAll(selector)) {
      const text = textFromElement(element);
      if (text.length < 30 || text.length > 5000 || seen.has(text)) {
        continue;
      }
      seen.add(text);
      rows.push({ element, text });
    }
  }

  return rows;
}

function firstMatch(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return '';
}

function extractItemsFromText(rawText) {
  const itemNames = [];
  const itemPatterns = [
    /(?:SKU\s*Name|Product\s*Name|Item\s*Name|ชื่อสินค้า|สินค้า)\s*[:：]\s*(.{2,120}?)(?=\s+(?:SKU|Seller\s*SKU|Tracking|Order\s*ID|Buyer|Customer|Ship\s*to|Recipient)\b|$)/gi,
  ];
  for (const pattern of itemPatterns) {
    for (const match of rawText.matchAll(pattern)) {
      const name = match?.[1]?.trim();
      if (name && !itemNames.includes(name)) {
        itemNames.push(name);
      }
    }
  }

  const skuNames = [];
  for (const match of rawText.matchAll(/(?:SKU|Seller SKU|SKU Code|รหัสสินค้า)\s*[:：#]?\s*([A-Z0-9][A-Z0-9._/-]{2,63})/gi)) {
    const sku = match?.[1]?.trim();
    if (sku && !skuNames.includes(sku)) {
      skuNames.push(sku);
    }
  }

  const count = Math.max(itemNames.length, skuNames.length);
  return Array.from({ length: count }, (_, index) => ({
    name: itemNames[index] ?? '',
    sku: skuNames[index] ?? '',
    quantity: 1,
  })).filter((item) => item.name || item.sku);
}

function extractShopeeCards({ platform }) {
  return Array.from(document.querySelectorAll('a[data-testid="order-item"]'))
    .map((element) => {
      const rawText = textFromElement(element);
      const orderId = firstMatch(rawText, [/หมายเลขคำสั่งซื้อ\s*([A-Z0-9]+)/i]);
      if (!orderId) {
        return null;
      }

      const afterOrderId = rawText.slice(rawText.indexOf(orderId) + orderId.length);
      const itemName = afterOrderId
        .split(/(?:ตัวเลือกสินค้า\s*:|\s+x\d+\b)/i)[0]
        .trim();
      const sku = firstMatch(rawText, [/\[([A-Z]{2,8}-[A-Z0-9-]{2,})\s*\]/i]);
      const trackingNo = rawText.match(/\b(?:TH|SPX|SPE|JNT|JT|KEX|LEX|BEST|FLASH|DHL|NINJA|NJV)[A-Z0-9-]{6,}\b/i)?.[0] ?? '';
      const quantity = Number.parseInt(firstMatch(rawText, [/\s+x(\d+)\b/i]), 10) || 1;

      return {
        platform,
        orderId,
        trackingNo,
        items: [{ name: itemName, sku, quantity }].filter((item) => item.name || item.sku),
        rawText,
      };
    })
    .filter(Boolean);
}

function extractCards({ platform }) {
  const trackingRe = /\b(?:TH|SPX|SPE|JNT|JT|KEX|LEX|BEST|FLASH|DHL|NINJA|NJV)[A-Z0-9-]{6,}\b/gi;
  const orderRe = /\b(?:20\d{10,}|[0-9]{10,20}|[A-Z0-9]{12,24})\b/g;
  return collectCandidateRows()
    .map(({ text: rawText }) => {
      const trackingNo = rawText.match(trackingRe)?.[0] ?? '';
      const orderId = rawText.match(orderRe)?.find((value) => value !== trackingNo) ?? '';
      if (!trackingNo && !orderId) {
        return null;
      }
      const courier = firstMatch(rawText, [
        /(?:Courier|Carrier|Logistics|ขนส่ง)\s*[:：]\s*([^\n|,]{2,80})/i,
      ]);
      const status = firstMatch(rawText, [
        /(?:Status|สถานะ)\s*[:：]\s*([^\n|,]{2,80})/i,
      ]);
      const orderCreatedAt = firstMatch(rawText, [
        /(?:Order\s*Time|Created\s*At|วันที่สั่งซื้อ|เวลาสั่งซื้อ)\s*[:：]\s*([^\n|,]{4,80})/i,
      ]);
      return {
        platform,
        orderId,
        trackingNo,
        status,
        courier,
        orderCreatedAt,
        items: extractItemsFromText(rawText),
        rawText,
      };
    })
    .filter(Boolean);
}

export const PLATFORMS = {
  tiktok: {
    label: 'TikTok Shop',
    loginUrl: 'https://seller-th.tiktok.com/account/login',
    orderListUrl: 'https://seller-th.tiktok.com/order',
    readySelectors: [
      '[data-testid*="order" i]',
      '[class*="order" i]',
      'table',
      'main',
    ],
    extractor: extractCards,
  },
  shopee: {
    label: 'Shopee Seller Centre',
    loginUrl: 'https://seller.shopee.co.th/account/signin',
    orderListUrl: 'https://seller.shopee.co.th/portal/sale/order',
    readySelectors: [
      '[class*="order" i]',
      '[class*="Order" i]',
      'table',
      'main',
    ],
    extractor: extractShopeeCards,
  },
  lazada: {
    label: 'Lazada Seller Center',
    loginUrl: 'https://sellercenter.lazada.co.th/apps/seller/login',
    orderListUrl: 'https://sellercenter.lazada.co.th/apps/order/list',
    readySelectors: [
      '[class*="order" i]',
      '[class*="Order" i]',
      'table',
      'main',
    ],
    extractor: extractCards,
  },
};

export function getPlatformConfig(platform) {
  return PLATFORMS[platform] ?? null;
}

export function listPlatformKeys() {
  return Object.keys(PLATFORMS);
}

export function getPlatformExtractorSource(platform) {
  const platformConfig = getPlatformConfig(platform);
  if (!platformConfig) {
    return '';
  }

  const extractorSource = platformConfig.extractor === extractShopeeCards
    ? 'const extractCards = extractShopeeCards;'
    : platformConfig.extractor.toString();

  return [
    textFromElement.toString(),
    collectCandidateRows.toString(),
    firstMatch.toString(),
    extractItemsFromText.toString(),
    extractShopeeCards.toString(),
    extractorSource,
  ].filter(Boolean).join('\n');
}
