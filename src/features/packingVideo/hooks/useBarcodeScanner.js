import { useEffect, useRef, useState } from 'react';

import {
  chooseDetectorFormats,
  createScanGate,
  isBarcodeDetectorSupported,
  readBarcodeValue,
} from '../logic/barcodeScanner.js';

/**
 * Interval between frame reads. Detection on a cheap Android tablet costs real CPU, and that
 * CPU is shared with the VP8 encoder that is recording the parcel — a tight loop drops frames
 * from the very clip this feature exists to produce. Three reads a second is still faster than
 * a person can present a label.
 */
const SCAN_INTERVAL_MS = 300;

/**
 * Reads barcodes off the preview video without opening a second camera.
 *
 * `enabled` is the caller's decision about when a scan is welcome — the dialog states must not
 * be interrupted by the camera firing another lookup underneath them.
 */
export function useBarcodeScanner({ videoRef, enabled, onDetect }) {
  const [status, setStatus] = useState('idle'); // idle | scanning | unsupported
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  useEffect(() => {
    if (!enabled) {
      setStatus('idle');
      return undefined;
    }
    if (!isBarcodeDetectorSupported()) {
      setStatus('unsupported');
      return undefined;
    }

    let stopped = false;
    let timer = null;
    let detector = null;
    const gate = createScanGate();

    async function build() {
      const supported = await globalThis.BarcodeDetector.getSupportedFormats?.() ?? [];
      const formats = chooseDetectorFormats(supported);
      if (!formats.length) return null;
      return new globalThis.BarcodeDetector({ formats });
    }

    async function tick() {
      if (stopped) return;
      const element = videoRef.current;
      // readyState below HAVE_CURRENT_DATA means there is no frame to decode yet; detect() would
      // throw on it.
      if (element && element.readyState >= 2) {
        try {
          const value = readBarcodeValue(await detector.detect(element));
          if (!stopped && gate.accept(value, Date.now())) onDetectRef.current?.(value);
        } catch {
          // A single unreadable frame is normal while the label is moving; the next tick retries.
        }
      }
      if (!stopped) timer = setTimeout(tick, SCAN_INTERVAL_MS);
    }

    build()
      .then((built) => {
        if (stopped) return;
        if (!built) {
          setStatus('unsupported');
          return;
        }
        detector = built;
        setStatus('scanning');
        void tick();
      })
      .catch(() => {
        if (!stopped) setStatus('unsupported');
      });

    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, videoRef]);

  return status;
}
