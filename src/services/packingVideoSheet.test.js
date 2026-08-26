import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ensurePackingVideoSheetConfig,
  parseAppendedRowNumber,
  withFreshToken,
} from './packingVideoSheet.js';

test('parseAppendedRowNumber reads the row Google actually wrote to', () => {
  assert.equal(parseAppendedRowNumber('PackingVideos!A42:N42'), 42);
  assert.equal(parseAppendedRowNumber("'PackingVideos'!A7:N7"), 7);
  assert.equal(parseAppendedRowNumber(undefined), 0);
  assert.equal(parseAppendedRowNumber('nonsense'), 0);
});

test('adds the packing-video spreadsheet to an existing Google config once', async () => {
  const config = { folder: { id: 'folder_1' }, master: { id: 'master_1' } };
  let calls = 0;

  const prepared = await ensurePackingVideoSheetConfig({
    token: 'token_1',
    config,
    prepare: async ({ token, config: receivedConfig }) => {
      calls += 1;
      assert.equal(token, 'token_1');
      assert.equal(receivedConfig, config);
      return { id: 'packing_1', name: 'Scan to Sheet Packing Videos' };
    },
  });

  assert.equal(calls, 1);
  assert.equal(prepared.master.id, 'master_1');
  assert.equal(prepared.packingVideos.id, 'packing_1');

  const reused = await ensurePackingVideoSheetConfig({
    token: 'token_2',
    config: prepared,
    prepare: async () => {
      calls += 1;
      return { id: 'unexpected' };
    },
  });

  assert.equal(calls, 1);
  assert.equal(reused, prepared);
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
