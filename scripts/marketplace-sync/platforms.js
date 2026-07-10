function extractCards({ platform }) {
  const trackingRe = /\b(?:TH|SPX|SPE|JNT|JT|KEX|LEX|BEST|FLASH|DHL|NINJA|NJV)[A-Z0-9-]{6,}\b/gi;
  const orderRe = /\b(?:20\d{10,}|[0-9]{10,20}|[A-Z0-9]{12,24})\b/g;
  const textFromElement = (element) => (element?.innerText || element?.textContent || '').replace(/\s+/g, ' ').trim();
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
      rows.push(text);
    }
  }

  return rows
    .map((rawText) => {
      const trackingNo = rawText.match(trackingRe)?.[0] ?? '';
      const orderId = rawText.match(orderRe)?.find((value) => value !== trackingNo) ?? '';
      if (!trackingNo && !orderId) {
        return null;
      }
      return {
        platform,
        orderId,
        trackingNo,
        status: '',
        courier: '',
        buyerName: '',
        orderCreatedAt: '',
        items: [],
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
    extractor: extractCards,
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
