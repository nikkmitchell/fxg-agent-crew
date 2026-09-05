/**
 * One place where "read every page" is implemented.
 *
 * WHY THIS EXISTS: three separate readers in this project have each mistaken a
 * window for the record — two of them mine. An agent's inbox advanced its
 * cursor past messages it had never displayed. A replay loop returned a partial
 * board as though it were complete. A page size above the server's silent cap
 * made an empty first page look like the end of history.
 *
 * Each was fixed where it was found, which is how the same omission kept
 * returning in different clothes. The traversal rules below are the fix stated
 * once, so that correcting them corrects every caller rather than one.
 */

/**
 * The largest page WebHarness actually honours.
 *
 * Measured, not assumed: limit=200 returns 200 messages, limit=500 returns ZERO
 * with no error. That is uniquely dangerous for this loop, because an empty
 * page is how it detects the end of history — so a page size over the cap makes
 * a reader stop on its first request and report an empty result as a complete
 * one.
 */
export const SERVER_MAX_PAGE = 200;

/** Ran out of guard with history still unread. */
export class PagesExhaustedError extends Error {
  constructor(readonly pagesRead: number, readonly itemsRead: number) {
    super(`stopped after ${pagesRead} pages (${itemsRead} items) with more history remaining`);
    this.name = "PagesExhaustedError";
  }
}

/** The cursor did not move, so continuing would loop forever. */
export class CursorStalledError extends Error {
  constructor(readonly afterId: number) {
    super(`cursor did not advance past ${afterId}`);
    this.name = "CursorStalledError";
  }
}

export type DrainOptions<T> = {
  /** Fetch one page strictly after `afterId`. */
  fetchPage: (afterId: number, limit: number) => Promise<T[]>;
  /** The ordering id of an item. */
  idOf: (item: T) => number;
  /** Resume point. 0 reads from the beginning. */
  startAfter?: number;
  pageLimit?: number;
  maxPages?: number;
};

/**
 * Read forward until the history genuinely ends.
 *
 * Returns every item after `startAfter`, and the id to resume from next time.
 *
 * THROWS rather than returning a partial result. A caller that receives fewer
 * items than exist cannot tell the difference between "that is all of it" and
 * "that is as far as I got", so returning early would hand back a result whose
 * incompleteness is invisible. Every caller here would rather fail loudly.
 *
 * The returned cursor is only ever an id we actually read. It is never
 * advanced speculatively, because a cursor that moves past unprocessed items
 * loses them permanently and silently.
 */
export async function drainPages<T>(options: DrainOptions<T>): Promise<{ items: T[]; lastId: number }> {
  const { fetchPage, idOf, startAfter = 0, maxPages = 200 } = options;
  // Clamped rather than trusted: a caller asking for more than the server
  // honours would otherwise get an empty page and read it as the end.
  const pageLimit = Math.min(options.pageLimit ?? SERVER_MAX_PAGE, SERVER_MAX_PAGE);

  const items: T[] = [];
  let afterId = startAfter;

  for (let page = 0; page < maxPages; page += 1) {
    const batch = await fetchPage(afterId, pageLimit);
    if (batch.length === 0) return { items, lastId: afterId };

    items.push(...batch);
    const highest = batch.reduce((max, item) => Math.max(max, idOf(item)), afterId);
    if (highest <= afterId) throw new CursorStalledError(afterId);
    afterId = highest;

    // A short page means the server had nothing more to give. A FULL page means
    // there may be more, even if there is not — so we ask again rather than
    // guess, and the extra request costs one round trip against the risk of
    // silently truncating.
    if (batch.length < pageLimit) return { items, lastId: afterId };
  }

  throw new PagesExhaustedError(maxPages, items.length);
}
