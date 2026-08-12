import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SCAN_METHOD } from './scanPreferences.js';

test('opens scanner controls in barcode gun mode by default', () => {
  assert.equal(DEFAULT_SCAN_METHOD, 'manual');
});
