import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pythonCandidates = [
  ...(process.env.PYTHON ? [{ command: process.env.PYTHON, prefix: [] }] : []),
  ...(process.platform === "win32"
    ? [{ command: "py", prefix: ["-3"] }, { command: "python", prefix: [] }, { command: "python3", prefix: [] }]
    : [{ command: "python3", prefix: [] }, { command: "python", prefix: [] }]),
];
const python = pythonCandidates.find(({ command, prefix }) =>
  spawnSync(command, [...prefix, "-c", "pass"], { stdio: "ignore" }).status === 0,
);

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
  const pythonTest = python ? it : it.skip;

  pythonTest("finishes a frame a timeout interrupts, and still hears a real close", () => {
    const script = fileURLToPath(new URL("../../tools/webharness/hold_presence_frames_check.py", import.meta.url));
    // Use the platform's launcher when available; this no-dependency probe is
    // skipped on developer machines without Python instead of failing the suite.
    if (!python) return;
    const output = execFileSync(python.command, [...python.prefix, script], {
      encoding: "utf8",
      // The imported module checks this variable at import time, but these
      // socket-unit tests never log in. Keep any real agent home out of scope.
      env: { ...process.env, WEBHARNESS_HOME: ".test-webharness-home" },
    });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok - a frame split across a timeout is finished");
    expect(output).toContain("ok - a genuine close still reads as a close");
  }, 60_000);
});
