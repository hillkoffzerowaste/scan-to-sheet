import test from 'node:test';
import assert from 'node:assert/strict';

import { getScanPopupCourierOptions, getScanPopupStatusMeta } from './scanPopup.js';

test('maps scan result types to popup feedback tones and icons', () => {
  assert.deepEqual(getScanPopupStatusMeta('success'), { tone: 'success', icon: 'check' });
  assert.deepEqual(getScanPopupStatusMeta('duplicate'), { tone: 'duplicate', icon: 'alert' });
  assert.deepEqual(getScanPopupStatusMeta('warning'), { tone: 'warning', icon: 'alert' });
  assert.deepEqual(getScanPopupStatusMeta('error'), { tone: 'error', icon: 'alert' });
  assert.deepEqual(getScanPopupStatusMeta('ignored'), { tone: 'ignored', icon: 'scan' });
});

test('falls back to a neutral popup presentation for unknown status types', () => {
  assert.deepEqual(getScanPopupStatusMeta('unexpected'), { tone: 'idle', icon: 'scan' });
  assert.deepEqual(getScanPopupStatusMeta(), { tone: 'idle', icon: 'scan' });
});

test('keeps the selected courier available and removes duplicate popup options', () => {
  assert.deepEqual(
    getScanPopupCourierOptions(['Shopee', 'Flash', 'Shopee'], 'J&T'),
    ['Shopee', 'Flash', 'J&T'],
  );
  assert.deepEqual(getScanPopupCourierOptions(['Shopee', 'Flash'], 'Flash'), ['Shopee', 'Flash']);
});
