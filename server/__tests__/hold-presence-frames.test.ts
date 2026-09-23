import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * tools/webharness/hold_presence_frames_check.py, run with the suite.
 *
 * hold-presence.py is the one thing that keeps an agent drawn AWAKE in the
 * room, and on 2026-09-24 it spent twenty minutes reconnecting every ~20s while
 * reporting "the room said goodbye" — which the room never did. A one-second
 * read timeout landing mid-frame threw away the bytes already read, and the
 * reader then parsed JSON as frame headers until a byte looked like a close.
 *
 * It is Python with no dependencies, so the checks are Python too; this runs
 * them here so release.sh refuses a release that breaks them.
 */
describe("the presence holder reads the room's frames", () => {
  it("finishes a frame a timeout interrupts, and still hears a real close", () => {
    const script = fileURLToPath(new URL("../../tools/webharness/hold_presence_frames_check.py", import.meta.url));
    // Throws with the script's output if any check fails, which is the report.
    const output = execFileSync("python3", [script], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok - a frame split across a timeout is finished");
    expect(output).toContain("ok - a genuine close still reads as a close");
  }, 60_000);
});
