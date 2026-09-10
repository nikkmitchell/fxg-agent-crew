import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every reader of room history must be classified, and stay classified.
 *
 * `saha-pagination-contract` asked for exactly this: each reader is either
 * exhaustive and uses the shared traversal, or it is a deliberately bounded
 * window whose contract is written down. The reason it is a test and not a
 * document is that documents do not fail.
 *
 * The history here is that the same omission arrived three times in different
 * clothes — an inbox that advanced past messages it never displayed, a replay
 * that returned a partial board as complete, a page size above the server's
 * silent cap turning an empty first page into "end of history". Each was fixed
 * where it was found, which is why it kept coming back. A fourth copy appeared
 * in tools/board-dump.mts while this very card was being worked on.
 *
 * So: adding a new reader fails the build until someone says which kind it is.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

/**
 * Files that may construct a room-messages URL, and what each one promises.
 *
 * Writes are listed too. They do not traverse anything, but a file that can
 * append to the durable log is worth noticing when it appears, and an
 * allowlist that only covered reads would quietly accept a new writer.
 */
const CLASSIFIED: Record<string, "exhaustive" | "bounded-window" | "write"> = {
  // Folds the board from the whole room. Uses drainPages; reads until a short
  // page proves the end, and throws rather than returning a partial result.
  "server/webharness/project-cache.ts": "exhaustive",
  // Live Chat. Asks for the most recent 50 and polls FORWARD; there is no
  // backwards paging because upstream's `before` cursor does not page. Reports
  // mayHaveEarlier so the transcript can say where it starts.
  "server/webharness/longpoll.ts": "bounded-window",
  // Terminal equivalent of the board fold. Same drainPages.
  "tools/board-dump.mts": "exhaustive",
  // Appends a crew-event to the room. Refuses over 2000 characters before
  // sending, so the durable log never receives something upstream will reject.
  "server/routes/projects.ts": "write",
  // The one-time import for ADR-002. Same drainPages, and it compares what it
  // wrote against a fold of the room before declaring success.
  "tools/import-from-chat.mts": "exhaustive",
  // Two things: it POSTs a chat message, and its GET delegates straight to
  // pollMessages. It has no traversal of its own, which is the point — an
  // earlier version of this project had three.
  "server/routes/rooms.ts": "write",
};

const SEARCH_DIRS = ["server", "src", "shared", "tools"];
const SKIP = new Set(["node_modules", "__tests__", "dist", "dist-server", ".git"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (SKIP.has(entry)) return [];
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|mts)$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [full] : [];
  });
}

/** Anything that builds a `/api/rooms/<room>/messages` URL. */
const READS_HISTORY = /\/api\/rooms\/\$\{[^}]*\}\/messages/;

describe("room-history readers", () => {
  it("are all classified", () => {
    const found = SEARCH_DIRS.flatMap((dir) => sourceFiles(resolve(root, dir)))
      .filter((file) => READS_HISTORY.test(readFileSync(file, "utf8")))
      .map((file) => relative(root, file))
      .sort();

    // An unclassified reader is not a style problem. It is the specific defect
    // that has already shipped three times here.
    expect(found).toEqual(Object.keys(CLASSIFIED).sort());
  });

  it("the exhaustive ones use the shared traversal rather than their own loop", () => {
    for (const [file, kind] of Object.entries(CLASSIFIED)) {
      if (kind !== "exhaustive") continue;
      const source = readFileSync(resolve(root, file), "utf8");
      expect(source, file).toMatch(/drainPages/);
    }
  });

  it("the bounded one declares its boundary rather than leaving it implicit", () => {
    for (const [file, kind] of Object.entries(CLASSIFIED)) {
      if (kind !== "bounded-window") continue;
      const source = readFileSync(resolve(root, file), "utf8");
      // A window that does not report being a window is indistinguishable from
      // the whole record, which is the failure this project exists to prevent.
      expect(source, file).toMatch(/mayHaveEarlier/);
    }
  });
});
