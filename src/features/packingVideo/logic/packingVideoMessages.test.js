import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { AUTH_SESSION_EXPIRED } from '../../../services/authErrors.js';
import { PACKING_VIDEO_MESSAGES, packingVideoErrorText } from './packingVideoMessages.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');

test('an unknown code still says something actionable', () => {
  // The bug this guards: an unmapped code rendered an empty banner, so a packer whose sign-in
  // had expired saw a screen that looked frozen rather than an error.
  const text = packingVideoErrorText('SOMETHING_NEW');
  assert.ok(text.length > 0);
  assert.ok(text.includes('SOMETHING_NEW'), 'the code must be quoted so Admin can act on it');
});

test('no code means no banner', () => {
  assert.equal(packingVideoErrorText(''), '');
  assert.equal(packingVideoErrorText(undefined), '');
});

test('an expired sign-in is spelled out rather than left blank', () => {
  const text = packingVideoErrorText(AUTH_SESSION_EXPIRED);
  assert.ok(text.includes('เซสชันหมดอายุ'));
  assert.ok(!text.includes(AUTH_SESSION_EXPIRED), 'the raw code must not leak into a mapped message');
});

test('every error code the module throws has Thai text', () => {
  // Codes are read off the source rather than listed here, so a new throw cannot quietly ship
  // without a message.
  const files = [
    'src/services/packingRecorder.js',
    'src/services/packingVideoDb.js',
    'src/services/cameraOwner.js',
    'src/services/packingVideos.js',
    'src/features/packingVideo/logic/packingSessionMachine.js',
    'src/features/packingVideo/logic/packingVideoIdentity.js',
    'src/features/packingVideo/logic/packingVideoFilters.js',
  ];

  const codes = new Set();
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const match of source.matchAll(/code: '(PACKING_VIDEO_[A-Z_]+)'/g)) codes.add(match[1]);
    for (const match of source.matchAll(/'(PACKING_VIDEO_[A-Z_]+)'/g)) codes.add(match[1]);
  }
  // Not an error: it is the status enum's own name.
  codes.delete('PACKING_VIDEO_STATUS');
  codes.delete('PACKING_VIDEO_STATUS_VALUES');

  const missing = [...codes].filter((code) => !PACKING_VIDEO_MESSAGES[code]);
  assert.deepEqual(missing, [], `codes without Thai text: ${missing.join(', ')}`);
});
