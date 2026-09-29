import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSheetRequestScheduler,
  SHEET_REQUEST_MIN_INTERVAL_MS,
  isSheetsApiRequest,
} from './sheetRequestScheduler.js';

test('production Sheets request policy stays below the per-user quota', () => {
  assert.equal(SHEET_REQUEST_MIN_INTERVAL_MS, 2_000);
  assert.equal(Math.floor(60_000 / SHEET_REQUEST_MIN_INTERVAL_MS), 30);
});

test('serializes concurrent requests and spaces their start times', async () => {
  let now = 0;
  const waits = [];
  const starts = [];
  let active = 0;
  let maxActive = 0;
  const scheduler = createSheetRequestScheduler({
    minIntervalMs: 2_000,
    now: () => now,
    sleep: async (ms) => {
      waits.push(ms);
      now += ms;
    },
  });

  const requests = [0, 1, 2].map((id) => scheduler.schedule(async () => {
    starts.push([id, now]);
    active += 1;
    maxActive = Math.max(maxActive, active);
    await Promise.resolve();
    active -= 1;
    return id;
  }));

  assert.deepEqual(await Promise.all(requests), [0, 1, 2]);
  assert.deepEqual(starts, [[0, 0], [1, 2_000], [2, 4_000]]);
  assert.deepEqual(waits, [2_000, 2_000]);
  assert.equal(maxActive, 1);
});

test('a failed request does not block the next queued request', async () => {
  let now = 0;
  const scheduler = createSheetRequestScheduler({
    minIntervalMs: 1_000,
    now: () => now,
    sleep: async (ms) => { now += ms; },
  });

  const failed = scheduler.schedule(async () => {
    throw new Error('temporary');
  });
  const recovered = scheduler.schedule(async () => 'ok');

  await assert.rejects(failed, /temporary/);
  assert.equal(await recovered, 'ok');
  assert.equal(now, 1_000);
});

test('only Sheets API requests are throttled', () => {
  assert.equal(isSheetsApiRequest('https://sheets.googleapis.com/v4/spreadsheets/sheet-1'), true);
  assert.equal(isSheetsApiRequest('https://www.googleapis.com/drive/v3/files'), false);
  assert.equal(isSheetsApiRequest('https://www.googleapis.com/oauth2/v3/userinfo'), false);
});
