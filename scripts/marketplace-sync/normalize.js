export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeCode(value) {
  return normalizeText(value).toUpperCase();
}

export function normalizeTrackingNo(value) {
  return normalizeCode(value).replace(/[^A-Z0-9]/g, '');
}

export function marketplaceMetadata(order) {
  const marketplaceOrderId = normalizeText(order?.orderId);
  const marketplaceSkus = [...new Set(
    (Array.isArray(order?.marketplaceSkus)
      ? order.marketplaceSkus
      : (Array.isArray(order?.items) ? order.items.map((item) => item?.sku) : []))
      .map((sku) => normalizeText(sku))
      .filter(Boolean),
  )];

  const marketplaceItems = (Array.isArray(order?.items) ? order.items : [])
    .map((item) => ({
      name: normalizeText(item?.name),
      sku: normalizeText(item?.sku),
      quantity: Number.isFinite(Number(item?.quantity)) ? Number(item.quantity) : '',
    }))
    .filter((item) => item.name || item.sku)
    .filter((item, index, items) => items.findIndex((candidate) => (
      candidate.name === item.name && candidate.sku === item.sku && candidate.quantity === item.quantity
    )) === index);

  return marketplaceOrderId ? { marketplaceOrderId, marketplaceSkus, marketplaceItems } : null;
}

export function safeDocPart(value) {
  return normalizeText(value).replace(/[\/\\#?\[\]]/g, '_').slice(0, 160);
}

export function normalizeOrder(raw, platform) {
  const orderId = normalizeText(raw.orderId);
  const trackingNo = normalizeText(raw.trackingNo);
  const normalizedTrackingNo = normalizeTrackingNo(trackingNo);
  const items = Array.isArray(raw.items)
    ? raw.items.map((item) => ({
        name: normalizeText(item.name),
        sku: normalizeText(item.sku),
        quantity: Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : 1,
      })).filter((item) => item.name || item.sku)
    : [];

  return {
    platform,
    orderId,
    trackingNo,
    normalizedTrackingNo,
    buyerName: normalizeText(raw.buyerName),
    courier: normalizeText(raw.courier),
    status: normalizeText(raw.status),
    orderCreatedAt: normalizeText(raw.orderCreatedAt),
    items,
    rawText: normalizeText(raw.rawText).slice(0, 2000),
  };
}

export function orderDocumentId(order) {
  const primary = order.orderId || order.normalizedTrackingNo || order.trackingNo;
  if (!primary) {
    return null;
  }
  return `${safeDocPart(order.platform)}__${safeDocPart(primary)}`;
}
