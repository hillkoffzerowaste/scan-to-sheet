export const DEFAULT_EXTERNAL_TOOLS_CONFIG = Object.freeze({
  sidebarTextSize: 'normal',
  groups: Object.freeze([
    Object.freeze({
      id: 'external-tools',
      name: 'เครื่องมือภายนอก',
      links: Object.freeze([
        Object.freeze({ id: 'delivery-system', label: 'ระบบส่งของ', url: 'https://repo-rho-livid.vercel.app/', accentColor: 'blue' }),
        Object.freeze({ id: 'wrong-delivery', label: 'จัดการส่งของผิด', url: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxQENSgzP-0IzDX0J_pY2g9HoMlCKMaNQYJlnxPbudqELr79oKdwYpoNflqrSAfsgw2/exec', accentColor: 'purple' }),
        Object.freeze({ id: 'label-checker', label: 'พิมพ์ใบเช็ค ใบปะหน้า', url: 'https://barcode-checker-ashy.vercel.app/', accentColor: 'teal' }),
        Object.freeze({ id: 'coffee-stock', label: 'เบิกออก/รับเข้ากาแฟถัง', url: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxETrRx_gJBuVTdl2MUaumr5Pem4LzahebQ6HZzrknPOr-PPCPmJHQ0I9f-p-kYJB-J/exec', accentColor: 'amber' }),
        Object.freeze({ id: 'coffee-shop-grinder', label: 'บดกาแฟหน้าร้าน', url: 'https://coffee-grinder-system.vercel.app/', accentColor: 'pink' }),
        Object.freeze({ id: 'coffee-stock-count', label: 'ตรวจนับสต็อกกาแฟ', url: 'https://script.google.com/macros/s/AKfycbyulSX89Q-eXvcd33QypMp8uP2_PrqjGjpBiYre_j2rJDXg74dNqGQ44jBgU1N_WNIXnA/exec', accentColor: 'slate' }),
      ]),
    }),
  ]),
});

export const SIDEBAR_TEXT_SIZES = Object.freeze([
  Object.freeze({ value: 'small', label: 'เล็ก' }),
  Object.freeze({ value: 'normal', label: 'ปกติ' }),
  Object.freeze({ value: 'large', label: 'ใหญ่' }),
]);

export const EXTERNAL_LINK_ACCENT_COLORS = Object.freeze([
  Object.freeze({ value: 'slate', label: 'เทา' }),
  Object.freeze({ value: 'blue', label: 'ฟ้า' }),
  Object.freeze({ value: 'cyan', label: 'ฟ้าใส' }),
  Object.freeze({ value: 'teal', label: 'เขียวฟ้า' }),
  Object.freeze({ value: 'lime', label: 'เขียวมะนาว' }),
  Object.freeze({ value: 'purple', label: 'ม่วง' }),
  Object.freeze({ value: 'violet', label: 'ม่วงอ่อน' }),
  Object.freeze({ value: 'pink', label: 'ชมพู' }),
  Object.freeze({ value: 'orange', label: 'ส้ม' }),
  Object.freeze({ value: 'amber', label: 'เหลือง' }),
]);

const VALID_SIDEBAR_TEXT_SIZES = new Set(SIDEBAR_TEXT_SIZES.map(({ value }) => value));
const VALID_ACCENT_COLORS = new Set(EXTERNAL_LINK_ACCENT_COLORS.map(({ value }) => value));
const LEGACY_ACCENT_COLORS = Object.freeze({ neutral: 'slate', rose: 'pink', green: 'lime', red: 'pink' });

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
  const sidebarTextSize = value.sidebarTextSize ?? 'normal';
  if (!VALID_SIDEBAR_TEXT_SIZES.has(sidebarTextSize)) return null;

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
      const accentColor = LEGACY_ACCENT_COLORS[rawLink.accentColor] ?? rawLink.accentColor ?? 'slate';
      if (!linkId || !label || !url || ids.has(linkId) || !VALID_ACCENT_COLORS.has(accentColor)) return null;
      ids.add(linkId);
      links.push({ id: linkId, label, url, accentColor });
    }

    groups.push({ id, name, links });
  }

  return { sidebarTextSize, groups };
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
