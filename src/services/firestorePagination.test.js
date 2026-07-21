import test from 'node:test';
import assert from 'node:assert/strict';

import { collectFirestorePages } from './firestorePagination.js';

test('collectFirestorePages returns every item across multiple pages', async () => {
  const allItems = Array.from({ length: 1201 }, (_, index) => index);
  const seenCursors = [];

  const result = await collectFirestorePages(async (cursor, pageSize) => {
    seenCursors.push(cursor);
    const start = cursor ?? 0;
    const items = allItems.slice(start, start + pageSize);
    return {
      items,
      nextCursor: start + items.length,
    };
  }, { pageSize: 500 });

  assert.deepEqual(result, allItems);
  assert.deepEqual(seenCursors, [null, 500, 1000]);
});

test('collectFirestorePages stops when a page is shorter than the requested size', async () => {
  let calls = 0;
  const result = await collectFirestorePages(async () => {
    calls += 1;
    return { items: ['only-page'], nextCursor: 'unused' };
  }, { pageSize: 500 });

  assert.deepEqual(result, ['only-page']);
  assert.equal(calls, 1);
});
