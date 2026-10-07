import { ApiError } from "../../api-request";
import { space } from "../../space-client";
import type { Host } from "../../engine/host";

/**
 * CTX.BOOKS IN THE ROOM (shared/books.ts; Nikk 7436): a shelf or one page from
 * saha.ing, which fetched it from Gutenberg when someone first looked. A
 * failure rejects with `why`, so a thing can say what happened.
 */
const WHY: Record<string, string> = { NOT_FOUND: "not-found", SOURCE_DOWN: "source-down", TOO_BIG: "too-big" };

const reason = (error: unknown) =>
  Object.assign(new Error(error instanceof ApiError ? error.message : "Could not reach saha.ing."), {
    why: error instanceof ApiError ? (WHY[error.code] ?? "refused") : "offline",
  });

export function createBookHost(): NonNullable<Host["books"]> {
  return {
    shelf: (n) => space.bookShelf(n).catch((error: unknown) => Promise.reject(reason(error))),
    search: (query, cursor) => space.bookSearch(query, cursor).catch((error: unknown) => Promise.reject(reason(error))),
    read: (id, page) => space.bookPage(id, page).catch((error: unknown) => Promise.reject(reason(error))),
  };
}
