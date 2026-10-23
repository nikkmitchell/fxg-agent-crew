import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * deploy/install-nginx.test.sh, run with the suite rather than by hand.
 *
 * It was not, and one of its checks failed for weeks without anybody seeing:
 * the /git/ location added a second client_max_body_size, and the body-limit
 * check read both numbers as one (found 2026-10-23). It also checks the
 * framing headers and the rollback of a bad install, which matter exactly
 * when nobody is thinking about them.
 */
const unixOnly = process.platform === "win32";
describe.skipIf(unixOnly)("installing the nginx config", () => {
  it("passes the checks in deploy/install-nginx.test.sh", () => {
    const script = fileURLToPath(new URL("../../deploy/install-nginx.test.sh", import.meta.url));
    let output: string;
    try {
      output = execFileSync("bash", [script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      const failed = error as { stdout?: string; stderr?: string };
      output = `${failed.stdout ?? ""}\n${failed.stderr ?? ""}`;
    }
    expect(output.split("\n").filter((line) => line.startsWith("FAIL"))).toEqual([]);
    expect(output).toContain("ok   - nginx body limit");
  }, 120_000);
});
