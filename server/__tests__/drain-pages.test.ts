import { describe, expect, it } from "vitest";
import { CursorStalledError, PagesExhaustedError, SERVER_MAX_PAGE, drainPages } from "../webharness/drain-pages.js";

/**
 * The rules three separate readers each got wrong. Tested once, here, so that
 * fixing them fixes every caller.
 */

const item = (id: number) => ({ id });
const source = (ids: number[]) => async (afterId: number, limit: number) =>
  ids.filter((id) => id > afterId).slice(0, limit).map(item);

const opts = (ids: number[], extra = {}) => ({ fetchPage: source(ids), idOf: (i: { id: number }) => i.id, ...extra });

describe("draining pages", () => {
  it("reads every page, not just the first", async () => {
    // The original bug in its simplest form: 250 items behind a 100-item page.
    const ids = Array.from({ length: 250 }, (_u, i) => i + 1);
    const { items, lastId } = await drainPages(opts(ids, { pageLimit: 100 }));
    expect(items).toHaveLength(250);
    expect(lastId).toBe(250);
  });

  it("resumes strictly after the cursor, with no overlap", async () => {
    const ids = Array.from({ length: 30 }, (_u, i) => i + 1);
    const { items } = await drainPages(opts(ids, { startAfter: 20 }));
    expect(items.map((i) => i.id)).toEqual([21, 22, 23, 24, 25, 26, 27, 28, 29, 30]);
  });

  it("returns the cursor unchanged when there is nothing new", async () => {
    // Must not rewind. A reader that resets to 0 on an empty page re-delivers
    // everything it has already handled.
    const { items, lastId } = await drainPages(opts([1, 2, 3], { startAfter: 3 }));
    expect(items).toEqual([]);
    expect(lastId).toBe(3);
  });

  it("throws rather than returning a partial result when the guard runs out", async () => {
    // Every page full and the guard exhausted. Returning here would hand back a
    // result whose incompleteness is invisible to the caller.
    const endless = async (afterId: number, limit: number) =>
      Array.from({ length: limit }, (_u, i) => item(afterId + i + 1));
    await expect(
      drainPages({ fetchPage: endless, idOf: (i: { id: number }) => i.id, pageLimit: 10, maxPages: 3 }),
    ).rejects.toBeInstanceOf(PagesExhaustedError);
  });

  it("throws if the cursor does not advance, rather than looping forever", async () => {
    const stuck = async () => [item(5)];
    await expect(
      drainPages({ fetchPage: stuck, idOf: (i: { id: number }) => i.id, startAfter: 5, pageLimit: 10 }),
    ).rejects.toBeInstanceOf(CursorStalledError);
  });

  it("clamps a page size above the server cap instead of trusting it", async () => {
    // limit=500 returns ZERO from this server with no error, and an empty page
    // is how this loop detects the end. Trusting the caller would make the very
    // first request look like the end of history.
    let asked = 0;
    await drainPages({
      fetchPage: async (afterId, limit) => {
        asked = limit;
        return afterId === 0 ? [item(1)] : [];
      },
      idOf: (i: { id: number }) => i.id,
      pageLimit: 500,
    });
    expect(asked).toBeLessThanOrEqual(SERVER_MAX_PAGE);
  });

  it("treats a short page as the end without an extra request", async () => {
    let calls = 0;
    const { items } = await drainPages({
      fetchPage: async (afterId, limit) => {
        calls += 1;
        return afterId === 0 ? [item(1), item(2)] : [];
      },
      idOf: (i: { id: number }) => i.id,
      pageLimit: 10,
    });
    expect(items).toHaveLength(2);
    expect(calls).toBe(1);
  });
});
