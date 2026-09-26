import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * deploy/public-check.test.sh, run with the suite rather than by hand.
 *
 * It guards the difference between "the site is wrong" and "this machine could
 * not ask", which a deploy gets to decide at the worst possible moment: twice
 * in one night a shipped, restarted, healthy deploy was reported FAILED
 * because a curl on the deploying laptop timed out.
 */
// A shell script, run by bash: there is no bash on native Windows, where this
// is skipped rather than failed (saha-ing-ce918b95). The deploy target is Linux.
const unixOnly = process.platform === "win32";
describe.skipIf(unixOnly)("asking the public URL from a machine with a flaky connection", () => {
  it("passes the checks in deploy/public-check.test.sh", () => {
    const script = fileURLToPath(new URL("../../deploy/public-check.test.sh", import.meta.url));
    const output = execFileSync("bash", [script], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok   - gives up with 000");
  });
});
