import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatBangkokDate,
  formatBangkokFileStamp,
  formatBangkokStamp,
  formatBuddhistDateTime,
  formatDuration,
} from './packingVideoFormat.js';

test('formatDuration renders HH:mm:ss', () => {
  assert.equal(formatDuration(138_000), '00:02:18');
  assert.equal(formatDuration(0), '00:00:00');
  assert.equal(formatDuration(3_723_000), '01:02:03');
  assert.equal(formatDuration(-5), '00:00:00');
  assert.equal(formatDuration(undefined), '00:00:00');
});

test('Bangkok stamps roll over the day at +07:00, not at UTC midnight', () => {
  // 17:30 UTC is already 00:30 the next morning in Bangkok. Getting this wrong is the 7-hour
  // bug this project has hit before, and it would file a clip under the previous day.
  const crossMidnight = new Date('2026-08-15T17:30:00Z');
  assert.equal(formatBangkokStamp(crossMidnight), '2026-08-16 00:30:00');
  assert.equal(formatBangkokDate(crossMidnight), '2026-08-16');
  assert.equal(formatBangkokFileStamp(crossMidnight), '20260816_003000');
});

test('Bangkok stamps keep the same day when the offset does not cross midnight', () => {
  const midday = new Date('2026-08-15T07:30:25Z');
  assert.equal(formatBangkokStamp(midday), '2026-08-15 14:30:25');
  assert.equal(formatBangkokFileStamp(midday), '20260815_143025');
});

test('formatBuddhistDateTime renders the Thai reading used in the duplicate dialog', () => {
  assert.equal(formatBuddhistDateTime(new Date('2026-08-15T07:30:25Z')), '15/08/2569 เวลา 14:30 น.');
});

test('invalid dates fail with a stable code', () => {
  assert.throws(
    () => formatBangkokStamp('not-a-date'),
    (error) => error.code === 'PACKING_VIDEO_INVALID_DATE',
  );
});
