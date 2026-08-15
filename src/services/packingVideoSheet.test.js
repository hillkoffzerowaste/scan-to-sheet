import test from 'node:test';
import assert from 'node:assert/strict';

import { parseAppendedRowNumber, withFreshToken } from './packingVideoSheet.js';

test('parseAppendedRowNumber reads the row Google actually wrote to', () => {
  assert.equal(parseAppendedRowNumber('PackingVideos!A42:N42'), 42);
  assert.equal(parseAppendedRowNumber("'PackingVideos'!A7:N7"), 7);
  assert.equal(parseAppendedRowNumber(undefined), 0);
  assert.equal(parseAppendedRowNumber('nonsense'), 0);
});

test('withFreshToken passes the current token straight through on success', async () => {
  const seen = [];
  const result = await withFreshToken(
    async (token) => { seen.push(token); return 'ok'; },
    { getToken: async () => 'token-1', refreshToken: async () => 'token-2' },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(seen, ['token-1']);
});

test('withFreshToken retries once with a refreshed token after a 401', async () => {
  // Without this, every clip uploaded after the access token expires would sit at
  // sheetStatus 'pending' with no visible failure.
  const seen = [];
  const result = await withFreshToken(
    async (token) => {
      seen.push(token);
      if (token === 'token-1') throw Object.assign(new Error('unauthorized'), { status: 401 });
      return 'ok';
    },
    { getToken: async () => 'token-1', refreshToken: async () => 'token-2' },
  );
  assert.equal(result, 'ok');
  assert.deepEqual(seen, ['token-1', 'token-2']);
});

test('withFreshToken does not retry errors that are not a 401', async () => {
  let calls = 0;
  await assert.rejects(
    withFreshToken(
      async () => { calls += 1; throw Object.assign(new Error('rate limited'), { status: 429 }); },
      { getToken: async () => 't', refreshToken: async () => 't2' },
    ),
    (error) => error.status === 429,
  );
  assert.equal(calls, 1);
});

test('withFreshToken surfaces the original 401 when the refresh yields nothing', async () => {
  await assert.rejects(
    withFreshToken(
      async () => { throw Object.assign(new Error('unauthorized'), { status: 401 }); },
      { getToken: async () => 't', refreshToken: async () => null },
    ),
    (error) => error.status === 401,
  );
});
