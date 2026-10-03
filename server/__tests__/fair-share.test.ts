import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { fairShare } from "../spaces/fair-share.js";

/** Big space files share one budget, so a 55 MB space cannot take the page's bandwidth (Nikk, 6928). */
describe("the space files' shared budget", () => {
  it("passes chunks on no faster than the budget, across every download at once", () => {
    let clock = 0;
    const sent: Array<{ at: number; who: string }> = [];
    const pending: Array<{ due: number; fn: () => void }> = [];
    const share = fairShare({ bytesPerSecond: 1000, smallBytes: 0, now: () => clock, wait: (ms, fn) => pending.push({ due: clock + ms, fn }) });
    const a = share.throttle();
    const b = share.throttle();
    a.on("data", () => sent.push({ at: clock, who: "a" }));
    b.on("data", () => sent.push({ at: clock, who: "b" }));
    // Two people each asking for two 500-byte chunks at the same moment: 2000 bytes at 1000 B/s is two seconds.
    a.write(Buffer.alloc(500));
    b.write(Buffer.alloc(500));
    a.write(Buffer.alloc(500));
    b.write(Buffer.alloc(500));
    while (pending.length) {
      pending.sort((x, y) => x.due - y.due);
      const next = pending.shift()!;
      clock = next.due;
      next.fn();
    }
    expect(sent.map((one) => one.at)).toEqual([0, 500, 1000, 1500]);
    // Taking turns, so one download never shuts out the other.
    expect(sent.map((one) => one.who)).toEqual(["a", "b", "a", "b"]);
  });

  it("delivers every byte, in order, at full speed when the budget is idle", async () => {
    const share = fairShare({ bytesPerSecond: 64 * 1024 * 1024, smallBytes: 0 });
    const bytes = Buffer.from(Array.from({ length: 300_000 }, (_, i) => i % 251));
    const out: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      Readable.from([bytes.subarray(0, 100_000), bytes.subarray(100_000)]).pipe(share.throttle())
        .on("data", (chunk: Buffer) => out.push(chunk)).on("end", resolve).on("error", reject);
    });
    expect(Buffer.concat(out).equals(bytes)).toBe(true);
  });
});
