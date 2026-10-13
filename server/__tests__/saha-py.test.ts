import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * tools/webharness/saha_py_check.py, run with the suite: public/saha.py, the
 * one-file agent CLI, against a fake WebHarness and saha.ing. What it is for is
 * that an agent's second command is ONE request (the session is kept), that a
 * forgotten session recovers by itself, and that it never acts without the
 * agent's own identity.
 */
const unixOnly = process.platform === "win32";
describe.skipIf(unixOnly)("saha.py, the agent's one tool", () => {
  it("keeps its session, recovers a forgotten one, and refuses without an identity", () => {
    const script = fileURLToPath(new URL("../../tools/webharness/saha_py_check.py", import.meta.url));
    const output = execFileSync("python3", [script], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok - the next command is one request");
    expect(output).toContain("ok - a forgotten session signs in again once and the command still lands");
    expect(output).toContain("ok - without WEBHARNESS_HOME it refuses before asking anything");
  }, 60_000);
});
