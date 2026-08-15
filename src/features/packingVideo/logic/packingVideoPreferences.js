import { isKnownStation } from '../packingVideoStations.js';

export const PREF_KEYS = {
  station: 'scan-to-sheet-packing-station-v1',
  deviceSeq: 'scan-to-sheet-packing-device-seq-v1',
  cameraDeviceId: 'scan-to-sheet-packing-camera-device-id-v1',
  packer: 'scan-to-sheet-packer-v1',
};

/** Matches the sentinel App.jsx uses so the two packer selectors agree on "not chosen yet". */
export const PACKER_UNASSIGNED = 'ยังไม่ระบุ';

const DEFAULTS = { station: '', deviceSeq: 1, cameraDeviceId: '', packer: '' };

/**
 * `storage` is injected so tests never touch a real localStorage, and so a corrupt or
 * unavailable store degrades to defaults instead of throwing during boot.
 */
export function readPackingPreferences(storage) {
  const read = (key) => {
    try {
      return storage?.getItem(key) ?? '';
    } catch {
      return '';
    }
  };

  const station = String(read(PREF_KEYS.station) ?? '').trim().toUpperCase();
  const seq = Number(read(PREF_KEYS.deviceSeq));

  return {
    station: isKnownStation(station) ? station : DEFAULTS.station,
    deviceSeq: Number.isFinite(seq) && seq >= 1 && seq <= 99 ? Math.floor(seq) : DEFAULTS.deviceSeq,
    cameraDeviceId: String(read(PREF_KEYS.cameraDeviceId) ?? '').trim(),
    packer: String(read(PREF_KEYS.packer) ?? '').trim(),
  };
}

export function writePackingPreferences(storage, patch = {}) {
  const write = (key, value) => {
    try {
      storage?.setItem(key, String(value));
    } catch {
      // A full or blocked store must not break packing; the value is a convenience, not data.
    }
  };

  if (patch.station !== undefined && isKnownStation(patch.station)) {
    write(PREF_KEYS.station, String(patch.station).trim().toUpperCase());
  }
  if (patch.deviceSeq !== undefined) {
    const seq = Math.floor(Number(patch.deviceSeq));
    if (Number.isFinite(seq) && seq >= 1 && seq <= 99) write(PREF_KEYS.deviceSeq, seq);
  }
  if (patch.cameraDeviceId !== undefined) {
    write(PREF_KEYS.cameraDeviceId, String(patch.cameraDeviceId).trim());
  }
  // Never persist the sentinel: writing it would wipe a real name while the staff list is
  // still loading and App.jsx has temporarily reset the selection.
  if (patch.packer !== undefined) {
    const packer = String(patch.packer).trim();
    if (packer && packer !== PACKER_UNASSIGNED) write(PREF_KEYS.packer, packer);
  }
}
