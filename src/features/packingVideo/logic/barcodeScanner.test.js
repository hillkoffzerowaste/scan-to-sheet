import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PACKING_BARCODE_FORMATS,
  REPEAT_WINDOW_MS,
  chooseDetectorFormats,
  createScanGate,
  isBarcodeDetectorSupported,
  readBarcodeValue,
} from './barcodeScanner.js';

test('support is decided by the API being present, not by user agent sniffing', () => {
  assert.equal(isBarcodeDetectorSupported({ BarcodeDetector: function () {} }), true);
  assert.equal(isBarcodeDetectorSupported({}), false);
  assert.equal(isBarcodeDetectorSupported(null), false);
});

test('only formats the device decodes are requested', () => {
  // The constructor throws on an unknown format, so one unsupported extra would cost all
  // scanning rather than just that format.
  assert.deepEqual(chooseDetectorFormats(['code_128', 'qr_code']), ['code_128', 'qr_code']);
  assert.deepEqual(chooseDetectorFormats(['pdf417', 'aztec']), []);
  assert.deepEqual(chooseDetectorFormats(undefined), []);
});

test('Code 128 is asked for first, since that is what courier labels carry', () => {
  assert.equal(PACKING_BARCODE_FORMATS[0], 'code_128');
});

test('the first usable detection wins and is trimmed', () => {
  assert.equal(readBarcodeValue([{ rawValue: '  TH123456789  ' }]), 'TH123456789');
  assert.equal(readBarcodeValue([{ rawValue: '' }, { rawValue: 'TH999' }]), 'TH999');
});

test('artwork misreads are ignored rather than scanned', () => {
  // A one or two character "barcode" is label decoration, and looking it up would tell the
  // packer the parcel does not exist.
  assert.equal(readBarcodeValue([{ rawValue: '7' }]), '');
  assert.equal(readBarcodeValue([]), '');
  assert.equal(readBarcodeValue(null), '');
});

test('a label held under the camera fires once, not once per frame', () => {
  // The bug this prevents: every frame starting a lookup, and mid-recording each one trying to
  // hand off the clip and start a new parcel.
  const gate = createScanGate();
  assert.equal(gate.accept('TH1', 0), true);
  assert.equal(gate.accept('TH1', 100), false);
  assert.equal(gate.accept('TH1', 1000), false);
});

test('the mute window is measured from when the label was last seen', () => {
  const gate = createScanGate({ repeatWindowMs: 1000 });
  assert.equal(gate.accept('TH1', 0), true);
  // Still in frame at 900ms, so the window restarts: leaving it there must not re-fire at 1001.
  assert.equal(gate.accept('TH1', 900), false);
  assert.equal(gate.accept('TH1', 1500), false);
  // Out of frame long enough, a deliberate re-scan of the same parcel is allowed through.
  assert.equal(gate.accept('TH1', 3000), true);
});

test('a different parcel is never blocked by the previous one', () => {
  const gate = createScanGate();
  assert.equal(gate.accept('TH1', 0), true);
  assert.equal(gate.accept('TH2', 10), true);
});

test('blank reads never open the gate', () => {
  const gate = createScanGate();
  assert.equal(gate.accept('', 0), false);
  assert.equal(gate.accept('   ', 0), false);
  assert.equal(gate.accept(undefined, 0), false);
});

test('reset clears the mute so a new session starts clean', () => {
  const gate = createScanGate();
  gate.accept('TH1', 0);
  gate.reset();
  assert.equal(gate.accept('TH1', 1), true);
});

test('the default window is long enough to move a parcel out of frame', () => {
  assert.ok(REPEAT_WINDOW_MS >= 3000);
});
