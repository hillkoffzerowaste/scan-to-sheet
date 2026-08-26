import test from 'node:test';
import assert from 'node:assert/strict';

import { extractTrackingToken } from './worker.js';

test('every courier prefix shape the app validates is still recognised', () => {
  // These mirror COURIER_RULES in src/services/googleSheets.js. A guard that rejects real
  // tracking numbers is worse than the false positives it was added to stop.
  assert.equal(extractTrackingToken('เลขพัสดุ TH1234567890 ค่ะ'), 'TH1234567890');
  assert.equal(extractTrackingToken('TH1234567890A'), 'TH1234567890A');
  assert.equal(extractTrackingToken('Tracking: LEXTH400123456'), 'LEXTH400123456');
  assert.equal(extractTrackingToken('KEXDOLM00037667'), 'KEXDOLM00037667');
  assert.equal(extractTrackingToken('KEXD0LM0003766710'), 'KEXD0LM0003766710');
  assert.equal(extractTrackingToken('THT123456789012'), 'THT123456789012');
  assert.equal(extractTrackingToken('SPX123456789'), 'SPX123456789');
});

test('an address is not mistaken for a tracking number', () => {
  // The regression: the old pattern accepted any word starting with a courier prefix as long
  // as a digit appeared anywhere after it, so a Thai address line written without a space
  // matched and a bogus tracking number was written onto the order.
  assert.equal(extractTrackingToken('THAILAND10250'), '');
  assert.equal(extractTrackingToken('BANGKOK THAILAND 10250'), '');
  assert.equal(extractTrackingToken('BESTSELLER2024'), '');
  assert.equal(extractTrackingToken('FLASHSALE2024'), '');
});

test('text with no courier prefix at all yields nothing', () => {
  assert.equal(extractTrackingToken('ไม่มีเลขพัสดุในหน้านี้'), '');
  assert.equal(extractTrackingToken('830123456789'), '');
  assert.equal(extractTrackingToken(''), '');
  assert.equal(extractTrackingToken(null), '');
  assert.equal(extractTrackingToken(undefined), '');
});

test('the first match in the text wins, so narrow selectors decide before body text', () => {
  assert.equal(extractTrackingToken('TH1111111111 then LEXTH400123456'), 'TH1111111111');
});
