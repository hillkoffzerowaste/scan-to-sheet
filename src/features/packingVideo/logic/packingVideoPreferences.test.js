import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDeviceCode, parseDeviceCode } from './packingVideoIdentity.js';
import {
  PACKER_UNASSIGNED,
  PREF_KEYS,
  readPackingPreferences,
  writePackingPreferences,
} from './packingVideoPreferences.js';

const fakeStorage = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
};

test('unset preferences read back as usable defaults', () => {
  const prefs = readPackingPreferences(fakeStorage());
  assert.deepEqual(prefs, { station: '', deviceSeq: 1, cameraDeviceId: '', packer: '' });
});

test('a missing or throwing storage degrades to defaults instead of breaking boot', () => {
  assert.equal(readPackingPreferences(undefined).deviceSeq, 1);
  const broken = { getItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readPackingPreferences(broken), { station: '', deviceSeq: 1, cameraDeviceId: '', packer: '' });
});

test('corrupt stored values are ignored', () => {
  const prefs = readPackingPreferences(fakeStorage({
    [PREF_KEYS.station]: 'PACK-Z',
    [PREF_KEYS.deviceSeq]: 'not-a-number',
  }));
  assert.equal(prefs.station, '');
  assert.equal(prefs.deviceSeq, 1);
});

test('valid values round-trip', () => {
  const storage = fakeStorage();
  writePackingPreferences(storage, { station: 'pack-b', deviceSeq: 3, cameraDeviceId: 'cam-1', packer: 'มิ้ว' });
  assert.deepEqual(readPackingPreferences(storage), {
    station: 'PACK-B',
    deviceSeq: 3,
    cameraDeviceId: 'cam-1',
    packer: 'มิ้ว',
  });
});

test('the unassigned sentinel never overwrites a real packer', () => {
  // App.jsx resets the selection to this while the staff list loads; persisting it would wipe
  // the name the packer chose last shift.
  const storage = fakeStorage({ [PREF_KEYS.packer]: 'มิ้ว' });
  writePackingPreferences(storage, { packer: PACKER_UNASSIGNED });
  writePackingPreferences(storage, { packer: '' });
  assert.equal(readPackingPreferences(storage).packer, 'มิ้ว');
});

test('a write that a full storage rejects does not throw', () => {
  const storage = { getItem: () => null, setItem: () => { throw new Error('quota'); } };
  assert.doesNotThrow(() => writePackingPreferences(storage, { station: 'PACK-A' }));
});

test('device codes are derived from station and sequence', () => {
  assert.equal(buildDeviceCode('PACK-A', 1), 'PACK-A-01');
  assert.equal(buildDeviceCode('pack-c', 12), 'PACK-C-12');
  assert.deepEqual(parseDeviceCode('PACK-A-01'), { stationId: 'PACK-A', seq: 1 });
  assert.equal(parseDeviceCode('PACK-Z-01'), null);
  assert.equal(parseDeviceCode('nonsense'), null);
});

test('invalid station or sequence fails with a stable code', () => {
  assert.throws(() => buildDeviceCode('PACK-Z', 1), (error) => error.code === 'PACKING_VIDEO_INVALID_STATION');
  assert.throws(() => buildDeviceCode('PACK-A', 0), (error) => error.code === 'PACKING_VIDEO_INVALID_DEVICE_SEQ');
  assert.throws(() => buildDeviceCode('PACK-A', 100), (error) => error.code === 'PACKING_VIDEO_INVALID_DEVICE_SEQ');
});
