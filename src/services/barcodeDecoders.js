import {
  PACKING_BARCODE_FORMATS,
  ZXING_FORMATS,
  chooseDetectorFormats,
  isBarcodeDetectorSupported,
  toDetections,
} from '../features/packingVideo/logic/barcodeScanner.js';

/**
 * Barcode decoding for the packing bench, with two backends behind one interface.
 *
 * The browser's own BarcodeDetector is free and fast where it exists — but it does not exist
 * everywhere this app runs. Chrome on Android has it; the Android System WebView that Capacitor
 * loads the app in generally does not, and neither does Chrome on Windows. Since the packer's
 * phone may well be the WebView case, a bundled WASM decoder stands behind it so "scan the
 * label" is never answered with "not on this device".
 *
 * Neither backend touches getUserMedia: both read frames from the <video> element that the
 * MediaRecorder is already filming, so the recording is never at risk.
 */

/** Frame size handed to the WASM decoder. Full 720p costs far more CPU for no extra reads. */
const DECODE_WIDTH = 640;

let wasmModulePromise = null;

async function loadWasmReader() {
  wasmModulePromise ??= (async () => {
    const [{ readBarcodes, prepareZXingModule }, { default: wasmUrl }] = await Promise.all([
      import('zxing-wasm/reader'),
      import('zxing-wasm/reader/zxing_reader.wasm?url'),
    ]);
    // Served from our own bundle, not a CDN: the packing room's connection is not something to
    // bet evidence capture on, and a strict CSP would block the default fetch anyway.
    prepareZXingModule({ overrides: { locateFile: () => wasmUrl }, fireImmediately: true });
    return readBarcodes;
  })();
  return wasmModulePromise;
}

function drawFrame(video, canvas) {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;

  const scale = Math.min(1, DECODE_WIDTH / width);
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Builds the best decoder this device can run.
 *
 * Returns null only when neither backend can start, which the caller reports as "use the gun or
 * type it" rather than leaving the packer looking at a camera that quietly does nothing.
 */
export async function createBarcodeDecoder({ scope = globalThis } = {}) {
  if (isBarcodeDetectorSupported(scope)) {
    try {
      const supported = await scope.BarcodeDetector.getSupportedFormats?.() ?? [];
      const formats = chooseDetectorFormats(supported);
      if (formats.length) {
        const detector = new scope.BarcodeDetector({ formats });
        return {
          kind: 'native',
          detect: (video) => detector.detect(video),
        };
      }
    } catch {
      // Present but unusable — some builds expose the constructor and then throw. Fall through.
    }
  }

  try {
    const readBarcodes = await loadWasmReader();
    const canvas = scope.document?.createElement('canvas');
    if (!canvas) return null;
    return {
      kind: 'wasm',
      detect: async (video) => {
        const frame = drawFrame(video, canvas);
        if (!frame) return [];
        return toDetections(await readBarcodes(frame, {
          formats: ZXING_FORMATS,
          // tryHarder doubles the work per frame; at three frames a second the next frame is a
          // cheaper way to get a read than grinding on this one.
          tryHarder: false,
          maxNumberOfSymbols: 1,
        }));
      },
    };
  } catch {
    return null;
  }
}

export { PACKING_BARCODE_FORMATS };
