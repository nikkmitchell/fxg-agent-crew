import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { CrewState } from "../../src/event-core.js";

/**
 * Keeps the replay memo across a restart — but only when the code is identical.
 *
 * THE OBJECTION THIS ANSWERS: a cache that survived a deploy would be "a claim
 * about history nobody verified". That is right, and it is why the memo was
 * deliberately discarded on every restart. The cost is that each deploy makes
 * the next visitor pay a full room replay, measured between six and nineteen
 * seconds and rising with the room.
 *
 * The objection is really about the CODE, not about time. A fold is only
 * trustworthy if the rules that produced it are the rules now running: if
 * validation tightened, or the reducer changed, yesterday's fold was computed
 * by a different program and is worthless.
 *
 * So the memo is keyed by the deployed commit. Same commit, same fold, safe to
 * resume. Different commit — or no commit recorded, which is the honest state
 * of a hand-started service — and it is discarded and replayed from zero.
 *
 * It is still never a source of truth. WebHarness remains the only durable
 * store; this is an optimisation that can be deleted at any moment with no loss
 * beyond speed.
 */

export type Memo = { commit: string; room: string; lastId: number; state: CrewState };

const FILE = "project-memo.json";

/** Where the memo lives, next to the session database in StateDirectory. */
export function memoPath(stateDir: string): string {
  return resolve(stateDir, FILE);
}

/**
 * Load the memo for a room, or null.
 *
 * Null for every reason that is not "this exact commit wrote it": no file,
 * unreadable, wrong room, or a different commit. Every one of those is treated
 * identically, because a memo we cannot fully vouch for is worth exactly as
 * much as no memo at all.
 */
export function loadMemo(stateDir: string, room: string, commit: string | null): Memo | null {
  if (!commit) return null;

  try {
    const raw = JSON.parse(readFileSync(memoPath(stateDir), "utf8")) as Partial<Memo>;
    if (raw.commit !== commit) return null;
    if (raw.room !== room) return null;
    if (typeof raw.lastId !== "number" || !raw.state) return null;
    return raw as Memo;
  } catch {
    return null;
  }
}

/**
 * Write the memo, atomically.
 *
 * Written to a temporary file and renamed, because a process killed mid-write
 * would otherwise leave truncated JSON that the next boot reads as corrupt.
 * That failure is survivable — loadMemo returns null and we replay — but a
 * needless full replay after every unlucky restart is exactly what this exists
 * to prevent.
 */
export function saveMemo(stateDir: string, memo: Memo): void {
  try {
    const target = memoPath(stateDir);
    mkdirSync(dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    writeFileSync(temporary, JSON.stringify(memo), "utf8");
    renameSync(temporary, target);
  } catch {
    // A memo that cannot be written is not an error worth failing a request
    // over. The next read simply replays, which is the behaviour we had before
    // this file existed.
  }
}
