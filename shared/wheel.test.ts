import { describe, expect, it } from "vitest";
import { pushStrength, spinAfter } from "./wheel.js";

describe("the prayer wheel", () => {
  it("keeps a push between a nudge and a spin", () => {
    expect(pushStrength(9)).toBe(1);
    expect(pushStrength(0)).toBe(0.2);
    expect(pushStrength("hard")).toBe(0.6);
  });
  it("spins hardest just after a push and slows to rest", () => {
    expect(spinAfter(1, 0)).toBeGreaterThan(spinAfter(1, 5));
    expect(spinAfter(1, 60)).toBeLessThan(0.01);
  });
});
