/**
 * Camera barcode scanning for the packing bench, built on the browser's own BarcodeDetector.
 *
 * html5-qrcode — used by the main scan tab — opens its own getUserMedia stream. Here the camera
 * is already held by the MediaRecorder for the whole session, and on Android a second open
 * yields NotReadableError, so running it would risk the recording in progress. BarcodeDetector
 * reads frames straight off the <video> element that is already showing the stream: no second
 * camera claim, and it keeps working while a clip is being recorded.
 */

/**
 * Formats worth asking for, most likely first. Thai courier labels are overwhelmingly Code 128,
 * with QR on marketplace labels; the rest are cheap to include and occasionally show up on
 * repacked or international parcels.
 */
export const PACKING_BARCODE_FORMATS = [
  'code_128',
  'qr_code',
  'code_39',
  'ean_13',
  'itf',
  'codabar',
];

export function isBarcodeDetectorSupported(scope = globalThis) {
  return typeof scope?.BarcodeDetector === 'function';
}

/**
 * Narrows the wanted formats to what this device actually decodes.
 *
 * The constructor throws on a format it does not know, so asking for the full list blind would
 * turn an unsupported extra into no scanning at all.
 */
export function chooseDetectorFormats(supportedFormats) {
  const supported = Array.isArray(supportedFormats) ? supportedFormats : [];
  return PACKING_BARCODE_FORMATS.filter((format) => supported.includes(format));
}

/** Trims a detection down to the tracking number, or an empty string if there is nothing usable. */
export function readBarcodeValue(detections) {
  if (!Array.isArray(detections)) return '';
  for (const detection of detections) {
    const value = String(detection?.rawValue ?? '').trim();
    // Single stray characters are almost always a misread of label artwork.
    if (value.length >= 4) return value;
  }
  return '';
}

/** How long the same code stays ignored after a successful read. */
export const REPEAT_WINDOW_MS = 4000;

/**
 * Gate against a camera firing the same label dozens of times a second.
 *
 * The scan loop sees the same barcode in every frame while the parcel sits under the lens, and
 * without this each frame would start a lookup — and, worse, re-trigger the "scan a new parcel"
 * transition mid-recording. A code is accepted once, then muted until it has been out of frame
 * for the repeat window.
 */
export function createScanGate({ repeatWindowMs = REPEAT_WINDOW_MS } = {}) {
  let lastCode = '';
  let lastAt = 0;

  return {
    accept(code, now) {
      const value = String(code ?? '').trim();
      if (!value) return false;
      if (value === lastCode && now - lastAt < repeatWindowMs) {
        // Still the same label under the camera: refresh the mute window rather than firing.
        lastAt = now;
        return false;
      }
      lastCode = value;
      lastAt = now;
      return true;
    },
    reset() {
      lastCode = '';
      lastAt = 0;
    },
  };
}
