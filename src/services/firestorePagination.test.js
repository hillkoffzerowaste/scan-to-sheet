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

test('collectFirestorePages never reads past maxItems', async () => {
  // A whole-collection sweep bills a read per document, so the cap has to stop the paging
  // itself, not just trim the result: an uncapped "ทุกวัน" search read every order ever
  // scanned to display 50.
  const requestedSizes = [];

  const result = await collectFirestorePages(async (cursor, pageSize) => {
    requestedSizes.push(pageSize);
    const start = cursor ?? 0;
    return {
      items: Array.from({ length: pageSize }, (_, index) => start + index),
      nextCursor: start + pageSize,
    };
  }, { pageSize: 500, maxItems: 1200 });

  assert.equal(result.length, 1200);
  assert.equal(result.at(-1), 1199);
  // The final page asks for the 200 still allowed, not another full 500.
  assert.deepEqual(requestedSizes, [500, 500, 200]);
});

test('collectFirestorePages is unbounded when no maxItems is given', async () => {
  const result = await collectFirestorePages(async (cursor, pageSize) => {
    const start = cursor ?? 0;
    if (start >= 30) return { items: [], nextCursor: null };
    return {
      items: Array.from({ length: pageSize }, (_, index) => start + index),
      nextCursor: start + pageSize,
    };
  }, { pageSize: 10 });

  assert.equal(result.length, 30);
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
