import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCREEN_LIMITS } from "../screens.js";

/**
 * public/share.html is a page with no build step, so it cannot import
 * SCREEN_LIMITS and keeps its own copy. A copy drifts: a page sending frames
 * larger than the server takes would be refused every second with nothing on
 * screen saying why. This holds the copy to the server's numbers.
 */
describe("the share page's limits", () => {
  it("are the server's", () => {
    const page = readFileSync(new URL("../../public/share.html", import.meta.url), "utf8");
    const copy = /const LIMITS = (\{[^}]+\})/.exec(page)?.[1];
    expect(copy, "share.html no longer has const LIMITS = {...}").toBeTruthy();
    const limits = Function(`return (${copy});`)() as Record<string, number>;
    expect(limits).toEqual({
      width: SCREEN_LIMITS.width,
      height: SCREEN_LIMITS.height,
      quality: SCREEN_LIMITS.quality,
      intervalMs: SCREEN_LIMITS.intervalMs,
      bytes: SCREEN_LIMITS.bytes,
    });
  });
});
