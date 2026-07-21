export async function collectFirestorePages(fetchPage, { pageSize = 500 } = {}) {
  const items = [];
  let cursor = null;

  while (true) {
    const page = await fetchPage(cursor, pageSize);
    const pageItems = Array.isArray(page?.items) ? page.items : [];
    items.push(...pageItems);

    if (pageItems.length === 0 || pageItems.length < pageSize || page?.nextCursor == null) {
      return items;
    }

    cursor = page.nextCursor;
  }
}
