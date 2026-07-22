import test from 'node:test';
import assert from 'node:assert/strict';

import { findCancellationRow, parseAppendUpdatedRange } from './googleSheets.js';

test('parseAppendUpdatedRange accepts one A:W row on the expected sheet', () => {
  assert.equal(parseAppendUpdatedRange("'2026-07-18'!A43:W43", '2026-07-18'), 43);
  assert.equal(parseAppendUpdatedRange('2026-07-18!$A$9:$W$9', '2026-07-18'), 9);
});

test('parseAppendUpdatedRange rejects shifted or multi-row appends', () => {
  assert.throws(() => parseAppendUpdatedRange("'2026-07-18'!O42:AK42", '2026-07-18'), /outside/);
  assert.throws(() => parseAppendUpdatedRange("'2026-07-18'!A42:W43", '2026-07-18'), /outside/);
});

test('findCancellationRow matches the previous-day packer row before an admin-only row', () => {
  const rows = [
    { no: 1, courier: 'Kerry', code: '', adminCode: 'TH123' },
    { no: 2, courier: 'Kerry', code: 'TH123', adminCode: '' },
    { no: 3, courier: 'Flash', code: 'TH123', adminCode: '' },
  ];

  assert.deepEqual(
    findCancellationRow(rows, { courier: 'Kerry', code: ' th123 ' }),
    rows[1],
  );
});
