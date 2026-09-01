import test from 'node:test';
import assert from 'node:assert/strict';

import { barcodeCharacterFromKeyEvent } from './barcodeKeyboard.js';

test('preserves letter case and maps physical letter keys when the active keyboard layout emits Thai', () => {
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'KeyA', key: 'a' }), 'a');
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'KeyZ', key: 'Z', shiftKey: true }), 'Z');
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'KeyA', key: 'ฟ' }), 'a');
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'KeyZ', key: 'ผ', shiftKey: true }), 'Z');
});

test('maps digits and common tracking punctuation independently of the keyboard layout', () => {
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'Digit1', key: 'ๅ' }), '1');
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'Numpad7', key: '7' }), '7');
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'Minus', key: 'ข' }), '-');
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'Slash', key: 'ฝ' }), '/');
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'Minus', key: 'ข', shiftKey: true }), '_');
});

test('does not intercept shortcuts, composition, navigation, or unsupported keys', () => {
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'KeyV', key: 'v', ctrlKey: true }), null);
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'KeyA', key: 'ฟ', isComposing: true }), null);
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'Enter', key: 'Enter' }), null);
  assert.equal(barcodeCharacterFromKeyEvent({ code: 'F1', key: 'F1' }), null);
});
