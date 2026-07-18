import test from 'node:test';
import assert from 'node:assert/strict';

import { nextCalendarDate } from './calendarDate.js';

test('nextCalendarDate advances without depending on local timezone', () => {
  assert.equal(nextCalendarDate('2026-07-18'), '2026-07-19');
  assert.equal(nextCalendarDate('2026-01-31'), '2026-02-01');
  assert.equal(nextCalendarDate('2026-12-31'), '2027-01-01');
});
