import { describe, expect, it } from "vitest";
import { cleanDrift, driftAt } from "./driftwood";

describe("driftwood", () => {
  it("takes one short line", () => {
    expect(cleanDrift("  thank   you ")).toBe("thank you");
    expect(cleanDrift("")).toBeNull();
    expect(cleanDrift(3)).toBeNull();
  });
  it("rests, then goes out and fades", () => {
    expect(driftAt(1)).toEqual({ out: 0, bob: 0, fade: 1 });
    expect(driftAt(6).out).toBeGreaterThan(0);
    expect(driftAt(20).fade).toBe(0);
  });
  it("stays still in reduced-motion mode, then clears without drifting or fading", () => {
    expect(driftAt(2, true)).toEqual({ out: 0, bob: 0, fade: 1 });
    expect(driftAt(8, true)).toEqual({ out: 0, bob: 0, fade: 1 });
    expect(driftAt(10.5, true)).toEqual({ out: 0, bob: 0, fade: 0 });
  });
});
