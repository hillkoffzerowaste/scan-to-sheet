export const DEFAULT_EXTERNAL_TOOLS_CONFIG = Object.freeze({
  groups: Object.freeze([
    Object.freeze({
      id: 'external-tools',
      name: 'เครื่องมือภายนอก',
      links: Object.freeze([
        Object.freeze({ id: 'delivery-system', label: 'ระบบส่งของ', url: 'https://repo-rho-livid.vercel.app/' }),
        Object.freeze({ id: 'wrong-delivery', label: 'จัดการส่งของผิด', url: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxQENSgzP-0IzDX0J_pY2g9HoMlCKMaNQYJlnxPbudqELr79oKdwYpoNflqrSAfsgw2/exec' }),
        Object.freeze({ id: 'label-checker', label: 'พิมพ์ใบเช็ค ใบปะหน้า', url: 'https://barcode-checker-ashy.vercel.app/' }),
        Object.freeze({ id: 'coffee-stock', label: 'เบิกออก/รับเข้ากาแฟถัง', url: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxETrRx_gJBuVTdl2MUaumr5Pem4LzahebQ6HZzrknPOr-PPCPmJHQ0I9f-p-kYJB-J/exec' }),
        Object.freeze({ id: 'coffee-shop-grinder', label: 'บดกาแฟหน้าร้าน', url: 'https://coffee-grinder-system.vercel.app/' }),
        Object.freeze({ id: 'coffee-stock-count', label: 'ตรวจนับสต็อกกาแฟ', url: 'https://script.google.com/macros/s/AKfycbyulSX89Q-eXvcd33QypMp8uP2_PrqjGjpBiYre_j2rJDXg74dNqGQ44jBgU1N_WNIXnA/exec' }),
      ]),
    }),
  ]),
});

export const EXTERNAL_TOOL_TEST_IDS = Object.freeze({
  'delivery-system': 'delivery-system-link',
  'wrong-delivery': 'wrong-delivery-link',
  'label-checker': 'label-checker-link',
  'coffee-stock': 'coffee-stock-link',
  'coffee-shop-grinder': 'coffee-shop-grinder-link',
  'coffee-stock-count': 'coffee-stock-count-link',
});

const MAX_GROUPS = 10;
const MAX_LINKS = 100;
const MAX_URL_LENGTH = 2048;
const MAX_ID_LENGTH = 128;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeId(value) {
  if (typeof value !== 'string') return null;
  const id = value.trim();
  return id.length > 0 && id.length <= MAX_ID_LENGTH ? id : null;
}

function normalizeName(value) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name.length > 0 ? name : null;
}

function normalizeUrl(value) {
  if (typeof value !== 'string') return null;
  const url = value.trim();
  if (url.length === 0 || url.length > MAX_URL_LENGTH) return null;

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) return null;
    return url;
  } catch {
    return null;
  }
}

export function normalizeExternalToolsConfig(value) {
  if (!isRecord(value) || !Array.isArray(value.groups) || value.groups.length > MAX_GROUPS) return null;

  const ids = new Set();
  let linkCount = 0;
  const groups = [];

  for (const rawGroup of value.groups) {
    if (!isRecord(rawGroup) || !Array.isArray(rawGroup.links)) return null;

    const id = normalizeId(rawGroup.id);
    const name = normalizeName(rawGroup.name);
    if (!id || !name || ids.has(id)) return null;
    ids.add(id);

    const links = [];
    for (const rawLink of rawGroup.links) {
      linkCount += 1;
      if (linkCount > MAX_LINKS || !isRecord(rawLink)) return null;

      const linkId = normalizeId(rawLink.id);
      const label = normalizeName(rawLink.label);
      const url = normalizeUrl(rawLink.url);
      if (!linkId || !label || !url || ids.has(linkId)) return null;
      ids.add(linkId);
      links.push({ id: linkId, label, url });
    }

    groups.push({ id, name, links });
  }

  return { groups };
}

export function validateExternalToolsConfig(value) {
  const normalized = normalizeExternalToolsConfig(value);
  if (!normalized) {
    throw Object.assign(new Error('ตรวจสอบชื่อหมวดและลิงก์อีกครั้ง'), {
      code: 'EXTERNAL_TOOLS_INVALID',
    });
  }
  return normalized;
}

