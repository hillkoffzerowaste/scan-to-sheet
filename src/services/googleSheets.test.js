import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAppendUpdatedRange } from './googleSheets.js';

test('parseAppendUpdatedRange accepts one A:W row on the expected sheet', () => {
  assert.equal(parseAppendUpdatedRange("'2026-07-18'!A43:W43", '2026-07-18'), 43);
  assert.equal(parseAppendUpdatedRange('2026-07-18!$A$9:$W$9', '2026-07-18'), 9);
});

test('parseAppendUpdatedRange rejects shifted or multi-row appends', () => {
  assert.throws(() => parseAppendUpdatedRange("'2026-07-18'!O42:AK42", '2026-07-18'), /outside/);
  assert.throws(() => parseAppendUpdatedRange("'2026-07-18'!A42:W43", '2026-07-18'), /outside/);
});
