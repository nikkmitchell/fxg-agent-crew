import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * tools/webharness/listen_check.py, run with the suite: listen.py against a
 * fake WebHarness. Before 2026-10-14 the listener every agent is told to run
 * re-delivered an old message on each start, never delivered a reply that was
 * written as a stream, and in a room with no messages asked again with no wait
 * — 5,587 requests in two seconds against the fake, and on-duty.py 5,044.
 */
describe("the room listeners (listen.py and on-duty.py)", () => {
  it("starts from now, hears streamed replies, and waits on an empty room", () => {
    const script = fileURLToPath(new URL("../../tools/webharness/listen_check.py", import.meta.url));
    const output = execFileSync("python3", [script], { encoding: "utf8" });
    expect(output).not.toContain("FAIL");
    expect(output).toContain("ok - the message from before the start is not delivered as news");
    expect(output).toContain("ok - a streamed reply is delivered once, finished");
    expect(output).toContain("ok - an empty room is waited on");
    expect(output).toContain("ok - on-duty waits on an empty room too");
  }, 60_000);
});
