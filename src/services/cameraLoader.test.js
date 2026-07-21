import test from 'node:test';
import assert from 'node:assert/strict';

import { loadHtml5Qrcode } from './cameraLoader.js';

test('loadHtml5Qrcode loads the scanner library on demand and reuses the promise', async () => {
  const first = loadHtml5Qrcode();
  const second = loadHtml5Qrcode();

  assert.equal(first, second);
  const module = await first;
  assert.equal(typeof module.Html5Qrcode, 'function');
  assert.ok(module.Html5QrcodeSupportedFormats);
});
