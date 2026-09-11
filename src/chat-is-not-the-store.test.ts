import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The chat room is not the board's storage, and nothing may still say it is.
 *
 * ADR-002 moved the board into SQLite on saha.ing. WebHarness keeps identity
 * and conversation. Four files still described a chat room as "the only durable
 * store" or "the durable log" long after that stopped being true, and one of
 * them was the header of the Chat panel itself.
 *
 * A stale comment is not cosmetic here. It is the explanation the next person
 * reads before deciding where to put something, and this particular claim
 * points them at a store that no longer accepts writes — exactly the mistake
 * `retired-write-path.test.ts` exists to catch after the fact. This catches the
 * sentence that causes it.
 */

const root = resolve(import.meta.dirname, "..");
const SKIP = new Set(["node_modules", "dist", "dist-server", ".git", ".dev-blobs", ".dev-stills"]);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (SKIP.has(entry)) return [];
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx|md)$/.test(entry) ? [full] : [];
  });
}

/**
 * Phrases that assert a chat room stores the board.
 *
 * Narrow on purpose. "the durable log" on its own now means the board's own
 * tables and is fine; it is the claim of EXCLUSIVITY, or of a room holding it,
 * that went false.
 */
const FALSE_CLAIMS = [
  /the room is the only durable store/i,
  /the only durable store we have/i,
  /chat is the durable store/i,
];

describe("what the code says about where the board lives", () => {
  it("nowhere claims a chat room is the durable store", () => {
    const offenders: string[] = [];
    for (const file of sources(root)) {
      // This file quotes the phrases in order to ban them.
      if (file.endsWith("chat-is-not-the-store.test.ts")) continue;
      const text = readFileSync(file, "utf8");
      for (const claim of FALSE_CLAIMS) {
        if (claim.test(text)) offenders.push(`${relative(root, file)} — ${claim}`);
      }
    }
    expect(offenders, "ADR-002 moved the board out of chat; these still say otherwise").toEqual([]);
  });
});
