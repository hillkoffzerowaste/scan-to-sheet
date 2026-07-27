import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const parserPath = path.resolve(TEST_DIR, '../../apps-script/label-sync/LabelParser.gs');

function loadParser() {
  if (!existsSync(parserPath)) return {};
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
      recipientName: 'สมชาย ใจดี',
      address: '12/3 ถนนตัวอย่าง แขวงทดสอบ เขตกลาง กรุงเทพมหานคร 10100',
      combined: 'สมชาย ใจดี | 12/3 ถนนตัวอย่าง แขวงทดสอบ เขตกลาง กรุงเทพมหานคร 10100',
    },
    {
      platform: 'shopee',
      orderId: 'SHP260727002',
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
      recipientName: 'Sample Recipient',
      address: '12/3 Example Road แขวงตัวอย่าง เขตกลาง กรุงเทพมหานคร 10100',
      combined: 'Sample Recipient | 12/3 Example Road แขวงตัวอย่าง เขตกลาง กรุงเทพมหานคร 10100',
    },
    {
      platform: 'shopee',
      orderId: 'SHP260727004',
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
