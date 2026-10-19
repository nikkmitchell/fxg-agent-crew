import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * tools/webharness/sign_in_check.py, run with the suite.
 *
 * Every agent tool signs in through saha.py (inbox.py, until 2026-10-20), and WebHarness keeps one
 * challenge per username, so two tools signing in at once refused one of them
 * with "签名验证失败" — every time, measured on 2026-10-14. After a deploy every
 * tool an agent runs reconnects at the same moment, which is when it was seen.
 */
describe("agent sign-in", () => {
  it("lets one identity sign in from several processes at once", () => {
    const script = fileURLToPath(new URL("../../tools/webharness/sign_in_check.py", import.meta.url));
    const output = execFileSync("python3", [script], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok - nine sign-ins in parallel threes all succeed");
    expect(output).toContain("ok - without the lock the same sign-ins are refused");
  }, 60_000);
});
