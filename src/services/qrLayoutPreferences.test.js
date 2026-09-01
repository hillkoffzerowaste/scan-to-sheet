import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_QR_LAYOUT_PREFERENCES,
  QR_LAYOUT_STORAGE_KEY,
  loadQrLayoutPreferences,
  normalizeQrLayoutPreferences,
  saveQrLayoutPreferences,
} from './qrLayoutPreferences.js';

function createStorage(initialValue = null) {
  let value = initialValue;
  return {
    getItem: () => value,
    setItem: (_key, nextValue) => { value = nextValue; },
  };
}

test('QR layout preferences accept only the supported presets', () => {
  assert.deepEqual(normalizeQrLayoutPreferences({ workspace: 'compact', popup: 'large' }), {
    workspace: 'compact', popup: 'large',
  });
  assert.deepEqual(normalizeQrLayoutPreferences({ workspace: 'freeform', popup: null }), DEFAULT_QR_LAYOUT_PREFERENCES);
});

test('QR layout preferences persist independently for workspace and popup', () => {
  const storage = createStorage();
  saveQrLayoutPreferences({ workspace: 'large', popup: 'compact' }, storage);
  assert.equal(JSON.parse(storage.getItem(QR_LAYOUT_STORAGE_KEY)).workspace, 'large');
  assert.deepEqual(loadQrLayoutPreferences(storage), { workspace: 'large', popup: 'compact' });
});

test('QR layout preferences fall back safely when saved data is malformed or storage is blocked', () => {
  const malformedStorage = createStorage('{not-json');
  assert.deepEqual(loadQrLayoutPreferences(malformedStorage), DEFAULT_QR_LAYOUT_PREFERENCES);

  const blockedStorage = {
    getItem: () => { throw new Error('blocked'); },
    setItem: () => { throw new Error('blocked'); },
  };
  assert.deepEqual(loadQrLayoutPreferences(blockedStorage), DEFAULT_QR_LAYOUT_PREFERENCES);
  assert.deepEqual(saveQrLayoutPreferences({ workspace: 'large', popup: 'compact' }, blockedStorage), {
    workspace: 'large', popup: 'compact',
  });
});
