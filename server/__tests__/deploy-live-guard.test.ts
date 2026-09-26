import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * deploy/live-guard.test.sh, run with the suite rather than by hand.
 *
 * The shell tests in deploy/ run when somebody remembers to run them. This one
 * guards against two worktrees undoing each other's live work, which is
 * exactly the situation in which nobody is thinking about it, so it runs with
 * everything else, including the suite release.sh runs before it ships.
 */
// A shell script, run by bash: there is no bash on native Windows, where this
// is skipped rather than failed (saha-ing-ce918b95). The deploy target is Linux.
const unixOnly = process.platform === "win32";
describe.skipIf(unixOnly)("a deploy that would roll back what is live", () => {
  it("is refused, by the checks in deploy/live-guard.test.sh", () => {
    const script = fileURLToPath(new URL("../../deploy/live-guard.test.sh", import.meta.url));
    // Throws with the script's output if any check fails, which is the report.
    const output = execFileSync("bash", [script], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok   - refuses when HEAD lacks the live commit");
    /**
     * A REAL DEADLINE FOR REAL WORK. This shells out to a script that makes
     * throwaway git repositories and runs release.sh against them: 7 to 12
     * seconds on a busy laptop, against vitest's default FIVE. So it passed
     * alone and failed inside the full suite, which reads exactly like a
     * regression somebody just caused and is not one.
     *
     * It cost a deploy. release.sh runs the suite before it ships, this timed
     * out, and the release refused with "tests failed; nothing was deployed" —
     * a correct refusal on a false premise, blocking a fix Nikk was waiting for
     * in a headset. A deadline shorter than the work is a test that reports the
     * load on the machine rather than the state of the code.
     */
  }, 120_000);
});
