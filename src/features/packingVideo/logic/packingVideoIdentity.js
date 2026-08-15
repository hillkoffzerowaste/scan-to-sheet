import { isKnownStation } from '../packingVideoStations.js';

export const MAX_DEVICE_SEQ = 99;

/**
 * `PACK-A-01` — the code printed on the workstation.
 *
 * Derived, never stored: keeping station and sequence as the only persisted values means the
 * displayed device code can never drift out of sync with the station actually selected.
 */
export function buildDeviceCode(stationId, seq) {
  const station = String(stationId ?? '').trim().toUpperCase();
  if (!isKnownStation(station)) {
    throw Object.assign(new Error('จุดแพ็คไม่ถูกต้อง'), { code: 'PACKING_VIDEO_INVALID_STATION' });
  }
  const parsed = Math.floor(Number(seq));
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > MAX_DEVICE_SEQ) {
    throw Object.assign(new Error('เลขเครื่องต้องอยู่ระหว่าง 1 ถึง 99'), {
      code: 'PACKING_VIDEO_INVALID_DEVICE_SEQ',
    });
  }
  return `${station}-${String(parsed).padStart(2, '0')}`;
}

export function parseDeviceCode(code) {
  const match = /^(PACK-[A-Z])-(\d{2})$/.exec(String(code ?? '').trim().toUpperCase());
  if (!match || !isKnownStation(match[1])) return null;
  return { stationId: match[1], seq: Number(match[2]) };
}
