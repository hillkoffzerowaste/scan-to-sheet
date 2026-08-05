/**
 * Page through a Firestore query.
 *
 * `maxItems` caps how many documents may be read in total. It exists because every document
 * a page touches is a billed read, so an unbounded caller (a whole-collection sweep) turns
 * one tap into a read for every order ever scanned. Omit it only when the query itself is
 * already bounded, for example by a date window.
 */
export async function collectFirestorePages(fetchPage, { pageSize = 500, maxItems = Infinity } = {}) {
  const items = [];
  let cursor = null;

  while (true) {
    if (items.length >= maxItems) {
      return items.slice(0, maxItems);
    }
    // Never request more than the cap still allows, so the last page cannot overshoot it.
    const size = Math.min(pageSize, maxItems - items.length);
    const page = await fetchPage(cursor, size);
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    items.push(...pageItems);

    if (pageItems.length === 0 || pageItems.length < size || page?.nextCursor == null) {
      return items.length > maxItems ? items.slice(0, maxItems) : items;
    }

    cursor = page.nextCursor;
  }
}
