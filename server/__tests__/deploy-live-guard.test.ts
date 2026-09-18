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
describe("a deploy that would roll back what is live", () => {
  it("is refused, by the checks in deploy/live-guard.test.sh", () => {
    const script = fileURLToPath(new URL("../../deploy/live-guard.test.sh", import.meta.url));
    // Throws with the script's output if any check fails, which is the report.
    const output = execFileSync("bash", [script], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok   - refuses when HEAD lacks the live commit");
  });
});
