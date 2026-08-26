import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const parserPath = path.resolve(TEST_DIR, '../../apps-script/label-sync/LabelParser.gs');

function loadParser() {
  // Fail loudly rather than returning {}. A silent skip is what let a second, untested
  // copy of LabelParser.gs sit in scripts/ and drift from the one that actually deploys.
  if (!existsSync(parserPath)) throw new Error(`Missing ${parserPath}`);
  const context = {};
  vm.runInNewContext(readFileSync(parserPath, 'utf8'), context, { filename: parserPath });
  return context.LabelParser ?? {};
}

function fixture(name) {
  return readFileSync(path.join(TEST_DIR, 'fixtures', name), 'utf8');
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test('parses every recipient from a multi-label Shopee file', () => {
  const parser = loadParser();
  assert.equal(typeof parser.parseLabels, 'function');

  const labels = plain(parser.parseLabels(fixture('shopee.txt'), 'shopee.pdf'));

  assert.deepEqual(labels, [
    {
      platform: 'shopee',
      orderId: 'SHP260727001',
      trackingId: '',
      recipientName: 'สมชาย ใจดี',
      address: '12/3 ถนนตัวอย่าง แขวงทดสอบ เขตกลาง กรุงเทพมหานคร 10100',
      combined: 'สมชาย ใจดี | 12/3 ถนนตัวอย่าง แขวงทดสอบ เขตกลาง กรุงเทพมหานคร 10100',
    },
    {
      platform: 'shopee',
      orderId: 'SHP260727002',
      trackingId: '',
      recipientName: 'สุดา ทดลอง',
      address: '88 หมู่ 5 ตำบลตัวอย่าง อำเภอเมือง เชียงใหม่ 50000',
      combined: 'สุดา ทดลอง | 88 หมู่ 5 ตำบลตัวอย่าง อำเภอเมือง เชียงใหม่ 50000',
    },
  ]);
});

test('parses Shopee PDF text when the TO and FROM headings precede the recipient name', () => {
  const parser = loadParser();

  assert.deepEqual(plain(parser.parseLabels(fixture('shopee-pdf-order.txt'), 'shopee.pdf')), [
    {
      platform: 'shopee',
      orderId: 'SHP260727003',
      trackingId: '',
      recipientName: 'Sample Recipient',
      address: '12/3 Example Road แขวงตัวอย่าง เขตกลาง กรุงเทพมหานคร 10100',
      combined: 'Sample Recipient | 12/3 Example Road แขวงตัวอย่าง เขตกลาง กรุงเทพมหานคร 10100',
    },
    {
      platform: 'shopee',
      orderId: 'SHP260727004',
      trackingId: '',
      recipientName: 'Second Recipient',
      address: '88 Example Village เชียงใหม่ 50000',
      combined: 'Second Recipient | 88 Example Village เชียงใหม่ 50000',
    },
  ]);
});

test('parses the Lazada customer block without copying the phone number', () => {
  const parser = loadParser();
  assert.equal(typeof parser.parseLabels, 'function');

  assert.deepEqual(plain(parser.parseLabels(fixture('lazada.txt'), 'lazada.pdf')), [{
    platform: 'lazada',
    orderId: 'LZD1117718175852180',
    trackingId: '',
    recipientName: 'นางทดสอบ ระบบงาน',
    address: '73/1 หมู่ 13 ตำบลตัวอย่าง บ้านโป่ง ราชบุรี 70110',
    combined: 'นางทดสอบ ระบบงาน | 73/1 หมู่ 13 ตำบลตัวอย่าง บ้านโป่ง ราชบุรี 70110',
  }]);
});

test('parses the TikTok recipient block and preserves a long order ID as text', () => {
  const parser = loadParser();
  assert.equal(typeof parser.parseLabels, 'function');

  assert.deepEqual(plain(parser.parseLabels(fixture('tiktok.txt'), 'tiktok.pdf')), [{
    platform: 'tiktok',
    orderId: '585225626528745423',
    trackingId: '',
    recipientName: 'คุณทดสอบ ติ๊กต็อก',
    address: '75/6 ถนนชุมแสง ตำบลบ้านพรุ หาดใหญ่ สงขลา 90250',
    combined: 'คุณทดสอบ ติ๊กต็อก | 75/6 ถนนชุมแสง ตำบลบ้านพรุ หาดใหญ่ สงขลา 90250',
  }]);
});

test('normalizes PDF control characters and rejects incomplete labels', () => {
  const parser = loadParser();
  assert.equal(typeof parser.parseLabels, 'function');

  assert.deepEqual(plain(parser.parseLabels('Order No.: A-1\u0000\nCustomer NAME: Only Name', 'bad.pdf')), []);
  assert.equal(parser.normalizeOrderId('shopee', ' shp- 1_2 '), 'SHP12');
});

test('extracts J&T tracking number from Shopee label text', () => {
  const parser = loadParser();
  assert.equal(typeof parser.extractTracking, 'function');

  assert.equal(parser.extractTracking('B899B-00-007L01\nShopee Order No. 260726P6WBVFGG'), 'B899B-00-007L01');
  assert.equal(parser.extractTracking('L946-00-524P03\nShopee Order No. 260727PSKK15RN'), 'L946-00-524P03');
  assert.equal(parser.extractTracking('Shopee Order No. 260726P6WBVFGG\nHOME'), '');
});

test('extracts JTTH tracking number from TikTok label text', () => {
  const parser = loadParser();
  assert.equal(typeof parser.extractTracking, 'function');

  assert.equal(parser.extractTracking('JTTH201795097265\nOrder ID: 585225626528745423'), 'JTTH201795097265');
  assert.equal(parser.extractTracking('Order ID: 585225626528745423\nNO TRACKING'), '');
});

test('parseLabels output always includes trackingId field (even empty)', () => {
  const parser = loadParser();
  // All platforms should include trackingId in their output object
  assert.deepEqual(plain(parser.parseLabels(fixture('shopee.txt'), 'shopee.pdf'))[0].trackingId, '');
  assert.deepEqual(plain(parser.parseLabels(fixture('lazada.txt'), 'lazada.pdf'))[0].trackingId, '');
  assert.deepEqual(plain(parser.parseLabels(fixture('tiktok.txt'), 'tiktok.pdf'))[0].trackingId, '');
});

test('extracts Thai Post tracking numbers from Shopee label text', () => {
  const parser = loadParser();
  assert.equal(typeof parser.extractTracking, 'function');

  assert.equal(parser.extractTracking('TH266907863837P\nShopee Order No. 260726NQRXWHWB'), 'TH266907863837P');
  assert.equal(parser.extractTracking('TH2673361907445\nShopee Order No. 260726P5K0P4C0'), 'TH2673361907445');
  assert.equal(parser.extractTracking('TH261849751923T\nHOME\nShopee Order No. 260727R5SD910W'), 'TH261849751923T');
});

test('parses Shopee Thai Post label with address at top of page', () => {
  const parser = loadParser();
  const text = 'HWPAO-AG - เวียงป่าเป้า\n' +
    '516 หมู่1, ตำบลแม่เจดีย์, อำเภอเวียงป่าเป้า, จังหวัดเชียงราย 57260\n' +
    'F-1\n-\nS\n516\nTH266907863837P\n' +
    '------------------------------------------\n' +
    'HOME\nไม่ต้องเก็บเงิน\n28-07-2026\n30-07-2026\n' +
    'Shopee Order No. 260726NQRXWHWB\nSHIP BY DATE\nPICKUP DATE\n' +
    'ผู้รับ (TO)\nผู้ส่ง (FROM)\n' +
    'ร้านกาแฟ Nerd\n' +
    'เลขที่ 66 ถนน ช้างเผือก ตำบลศรีภูมิ อำเภอเมืองเชียงใหม่ จังหวัดเชียงใหม่ 50200 ประเทศไทย\n' +
    'NOTE\nHILLKOFF ฮิลล์คอฟฟ์\nMP\nS\nN_B_2S_J09_HWPAO-AG\n';

  const labels = plain(parser.parseLabels(text, 'shopee.pdf'));
  assert.equal(labels.length, 1);
  assert.equal(labels[0].platform, 'shopee');
  assert.equal(labels[0].orderId, '260726NQRXWHWB');
  assert.equal(labels[0].recipientName, 'ร้านกาแฟ Nerd');
  // Address extracted from top section (new Thai Post format)
  assert.ok(labels[0].address.includes('516 หมู่1'));
  assert.ok(labels[0].address.includes('จังหวัดเชียงราย'));
  assert.ok(labels[0].address.includes('57260'));
  assert.ok(labels[0].combined.includes('ร้านกาแฟ Nerd'));
  assert.ok(labels[0].combined.includes('516 หมู่1'));
});

test('extractTracking returns empty for text without tracking numbers', () => {
  const parser = loadParser();
  assert.equal(parser.extractTracking(fixture('shopee.txt')), '');
  assert.equal(parser.extractTracking(fixture('lazada.txt')), '');
  assert.equal(parser.extractTracking('No tracking here\nJust some random text'), '');
});
