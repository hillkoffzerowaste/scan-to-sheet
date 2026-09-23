import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_EXTERNAL_TOOLS_CONFIG,
  EXTERNAL_LINK_ACCENT_COLORS,
  EXTERNAL_TOOL_TEST_IDS,
  normalizeExternalToolsConfig,
  validateExternalToolsConfig,
} from './externalToolsConfig.js';

const configWithLink = (url) => ({
  groups: [{ id: 'group-a', name: 'Tools', links: [{ id: 'link-a', label: 'Search', url }] }],
});

test('preserves the six existing external tools and their stable test IDs', () => {
  assert.deepEqual(DEFAULT_EXTERNAL_TOOLS_CONFIG.groups, [{
    id: 'external-tools',
    name: 'เครื่องมือภายนอก',
    links: [
      { id: 'delivery-system', label: 'ระบบส่งของ', url: 'https://repo-rho-livid.vercel.app/', accentColor: 'blue' },
      { id: 'wrong-delivery', label: 'จัดการส่งของผิด', url: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxQENSgzP-0IzDX0J_pY2g9HoMlCKMaNQYJlnxPbudqELr79oKdwYpoNflqrSAfsgw2/exec', accentColor: 'purple' },
      { id: 'label-checker', label: 'พิมพ์ใบเช็ค ใบปะหน้า', url: 'https://barcode-checker-ashy.vercel.app/', accentColor: 'teal' },
      { id: 'coffee-stock', label: 'เบิกออก/รับเข้ากาแฟถัง', url: 'https://script.google.com/a/macros/hillkoff.com/s/AKfycbxETrRx_gJBuVTdl2MUaumr5Pem4LzahebQ6HZzrknPOr-PPCPmJHQ0I9f-p-kYJB-J/exec', accentColor: 'amber' },
      { id: 'coffee-shop-grinder', label: 'บดกาแฟหน้าร้าน', url: 'https://coffee-grinder-system.vercel.app/', accentColor: 'pink' },
      { id: 'coffee-stock-count', label: 'ตรวจนับสต็อกกาแฟ', url: 'https://script.google.com/macros/s/AKfycbyulSX89Q-eXvcd33QypMp8uP2_PrqjGjpBiYre_j2rJDXg74dNqGQ44jBgU1N_WNIXnA/exec', accentColor: 'slate' },
    ],
  }]);
  assert.deepEqual(EXTERNAL_TOOL_TEST_IDS, {
    'delivery-system': 'delivery-system-link',
    'wrong-delivery': 'wrong-delivery-link',
    'label-checker': 'label-checker-link',
    'coffee-stock': 'coffee-stock-link',
    'coffee-shop-grinder': 'coffee-shop-grinder-link',
    'coffee-stock-count': 'coffee-stock-count-link',
  });
});

test('keeps an intentionally empty saved configuration', () => {
  assert.deepEqual(normalizeExternalToolsConfig({ groups: [] }), { sidebarTextSize: 'normal', groups: [] });
});

test('normalizes whitespace while retaining valid group and link IDs', () => {
  assert.deepEqual(normalizeExternalToolsConfig({
    groups: [{
      id: 'group-a',
      name: '  Tools  ',
      links: [{ id: 'link-a', label: '  Search  ', url: ' https://example.com/path ' }],
    }],
  }), {
    sidebarTextSize: 'normal',
    groups: [{
      id: 'group-a',
      name: 'Tools',
      links: [{ id: 'link-a', label: 'Search', url: 'https://example.com/path', accentColor: 'slate' }],
    }],
  });
});

test('normalizes supported sidebar preferences and rejects unknown values', () => {
  const configured = normalizeExternalToolsConfig({
    sidebarTextSize: 'large',
    groups: [{ id: 'g', name: 'Tools', links: [{ id: 'l', label: 'Search', url: 'https://example.com', accentColor: 'blue' }] }],
  });
  assert.equal(configured.sidebarTextSize, 'large');
  assert.equal(configured.groups[0].links[0].accentColor, 'blue');
  assert.equal(normalizeExternalToolsConfig({ sidebarTextSize: 'huge', groups: [] }), null);
  assert.equal(normalizeExternalToolsConfig({ groups: [{ id: 'g', name: 'Tools', links: [{ id: 'l', label: 'Link', url: 'https://example.com', accentColor: 'custom' }] }] }), null);
});

test('offers ten external-link accent colors and migrates retired palette keys', () => {
  const colors = EXTERNAL_LINK_ACCENT_COLORS.map(({ value }) => value);
  assert.equal(colors.length, 10);
  assert.equal(new Set(colors).size, 10);
  const links = ['neutral', 'rose', 'green', 'red'].map((accentColor, index) => ({
    id: 'link-' + index,
    label: 'Link ' + index,
    url: 'https://example.com/' + index,
    accentColor,
  }));
  const normalized = normalizeExternalToolsConfig({ groups: [{ id: 'g', name: 'Tools', links }] });
  assert.deepEqual(normalized.groups[0].links.map(({ accentColor }) => accentColor), ['slate', 'pink', 'lime', 'pink']);
});

test('rejects malformed payloads and duplicate IDs', () => {
  assert.equal(normalizeExternalToolsConfig(null), null);
  assert.equal(normalizeExternalToolsConfig({ groups: [{ id: 'g', name: 'Group', links: [] }, { id: 'g', name: 'Again', links: [] }] }), null);
  assert.equal(normalizeExternalToolsConfig({ groups: [{ id: 'g', name: 'Group', links: [{ id: 'l', label: 'One', url: 'https://a.com' }, { id: 'l', label: 'Two', url: 'https://b.com' }] }] }), null);
});

test('rejects empty group and link names', () => {
  assert.equal(normalizeExternalToolsConfig({ groups: [{ id: 'g', name: '  ', links: [] }] }), null);
  assert.equal(normalizeExternalToolsConfig({
    groups: [{
      id: 'group-a',
      name: 'Tools',
      links: [{ id: 'link-a', label: '  ', url: 'https://example.com' }],
    }],
  }), null);
});

test('accepts only HTTP or HTTPS URLs with a hostname', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'ftp://example.com', 'https://']) {
    assert.equal(normalizeExternalToolsConfig(configWithLink(url)), null, url);
  }
  assert.equal(validateExternalToolsConfig(configWithLink(' https://example.com/path ')).groups[0].links[0].url, 'https://example.com/path');
});

test('rejects URLs longer than 2048 characters', () => {
  assert.equal(normalizeExternalToolsConfig(configWithLink('https://example.com/' + 'a'.repeat(2030))), null);
});

test('enforces group and total link limits', () => {
  const tooManyGroups = Array.from({ length: 11 }, (_, index) => ({ id: 'g' + index, name: 'Group ' + index, links: [] }));
  assert.equal(normalizeExternalToolsConfig({ groups: tooManyGroups }), null);

  const links = Array.from({ length: 101 }, (_, index) => ({
    id: 'l' + index,
    label: 'Link ' + index,
    url: 'https://example.com/' + index,
  }));
  assert.equal(normalizeExternalToolsConfig({ groups: [{ id: 'g', name: 'Group', links }] }), null);
});

test('validation errors have a stable code and Thai user message', () => {
  assert.throws(
    () => validateExternalToolsConfig(configWithLink('javascript:alert(1)')),
    (error) => error.code === 'EXTERNAL_TOOLS_INVALID' && /[\u0E00-\u0E7F]/.test(error.message),
  );
});

test('custom link IDs never reuse a reserved test ID', () => {
  assert.equal(EXTERNAL_TOOL_TEST_IDS['custom-link'], undefined);
});
