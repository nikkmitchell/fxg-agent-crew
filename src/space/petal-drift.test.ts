import { describe, expect, it } from "vitest";
import { PETALS_AT, petalAt } from "./PetalDrift";

describe("drifting petals", () => {
  it("fall from above head height to the floor, over the garden and tea table", () => {
    for (let i = 0; i < 60; i += 1) {
      for (let s = 0; s < 120; s += 3.3) {
        const p = petalAt(i, s);
        expect(p.y).toBeLessThanOrEqual(PETALS_AT.top);
        expect(p.y).toBeGreaterThanOrEqual(-0.01);
        expect(Math.abs(p.x - PETALS_AT.x)).toBeLessThan(PETALS_AT.width);
      }
    }
  });
});
