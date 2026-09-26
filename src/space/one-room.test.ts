import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The room may not quietly split in two again.
 *
 * WHAT WENT WRONG THE FIRST TIME. Every panel had two implementations — an
 * iframe for the window, a photograph for the headset — so anything added to
 * one was simply missing from the other, and nobody noticed until somebody put
 * a headset on. The fix was to delete one of each pair. The fix does not hold
 * by itself: the next `inHeadset ?` in a panel is one line and rebuilds the
 * whole problem, and the suite would stay green while it did.
 *
 * So this reads the source. Every remaining use is listed below WITH ITS
 * REASON, and a use that is not on the list fails until somebody either removes
 * it or writes down why it belongs. The list is deliberately awkward to add to.
 *
 * THE SECOND TEST EARNED ITS KEEP IMMEDIATELY. I wrote this list from memory
 * and put four files on it that contain no such branch at all; the check that
 * the list is honest failed on the first run and named them. A stale exception
 * is worse than none, because it reads like a decision somebody made.
 *
 * THE RULE, stated once: a branch on where you are standing is allowed for the
 * SHAPE of a thing — what draws the camera, whether an opaque backdrop would
 * cover the real room — and never for WHAT A PERSON CAN DO. If one branch makes
 * a feature exist in one room and not the other, it is the bug, not an
 * exception to it.
 */

const ROOT = join(import.meta.dirname, "..");

/** file → why a branch on where you are standing is legitimate there. */
const ALLOWED: Record<string, string> = {
  "space/HeadsetControls.tsx":
    "the button that enters a session, whose own label has to say which side of the door you are on",
  "space/VrmBody.tsx":
    "asks whether ANOTHER PERSON has head tracking, to decide whether to animate their neck — nothing to do with how this viewer sees the room",
  "space/Scene.tsx":
    "the camera (a session drives its own), the opaque backdrop and the void (either would cover a passthrough view of the real room), and how hard the feeds poll",
  "space/SpacePanel.tsx": "holds the flag, and hands it to the three above",
};

const readAll = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return readAll(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });

describe("one room, not two", () => {
  it("has no branch on where you are standing outside the listed places", () => {
    const offenders: string[] = [];
    for (const path of readAll(ROOT)) {
      // Always "/": ALLOWED is written that way, and on Windows the path
      // arrived with backslashes and every listed file looked unlisted.
      const relative = path.slice(ROOT.length + 1).replaceAll("\\", "/");
      if (ALLOWED[relative]) continue;
      const source = readFileSync(path, "utf8");
      // Code only: a comment explaining the history is the opposite of the
      // problem, and this file is full of them.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("//"))
        .join("\n");
      if (/\binHeadset\b|\bisPresenting\b/.test(code)) offenders.push(relative);
    }
    expect(
      offenders,
      `these branch on where the viewer is standing without a stated reason:\n  ${offenders.join(
        "\n  ",
      )}\nIf it changes WHAT A PERSON CAN DO, it is the two-rooms bug — delete it. If it only changes the shape of something, add it to ALLOWED with the reason.`,
    ).toEqual([]);
  });

  it("keeps the allow-list honest", () => {
    // A list that names files which no longer exist, or which no longer
    // contain what it excuses, stops being a record and becomes decoration.
    for (const [relative, reason] of Object.entries(ALLOWED)) {
      const source = (() => {
        try {
          return readFileSync(join(ROOT, relative), "utf8");
        } catch {
          return null;
        }
      })();
      expect(source, `${relative} is on the allow-list but is not there any more`).not.toBeNull();
      expect(/\binHeadset\b|\bisPresenting\b/.test(source!), `${relative} no longer needs its exception — remove it`).toBe(true);
      expect(reason.length, `${relative} needs a real reason`).toBeGreaterThan(20);
    }
  });

  it("has no panel rendered only in one of the two rooms", () => {
    // The specific shape of the original bug: a ternary choosing a whole
    // different component depending on where you were standing.
    for (const path of readAll(ROOT)) {
      const code = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/inHeadset\s*\?\s*</.test(code), `${path.slice(ROOT.length + 1)} picks a component by where you are standing`).toBe(false);
    }
  });
});
