import { describe, expect, it } from "vitest";
import { onSand, stepGlow } from "./GlowSteps";
import { SHORE_AT } from "./Shore";

describe("glowing steps", () => {
  it("only on the sand", () => {
    expect(onSand(SHORE_AT.x, SHORE_AT.z)).toBe(true);
    expect(onSand(0, 6.2)).toBe(false);
  });
  it("bright at once, gone after twelve seconds", () => {
    expect(stepGlow(0)).toBe(1);
    expect(stepGlow(6000)).toBeGreaterThan(0);
    expect(stepGlow(13_000)).toBe(0);
  });
  it("keeps a print steadily lit until it disappears", () => {
    expect(stepGlow(0, true)).toBe(1);
    expect(stepGlow(6_000, true)).toBe(1);
    expect(stepGlow(13_000, true)).toBe(0);
  });
});
