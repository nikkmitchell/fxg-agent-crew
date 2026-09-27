import { describe, expect, it } from "vitest";
import { FIREFLIES_AT, fireflyAt } from "./Fireflies";

describe("fireflies", () => {
  it("wander within the swarm, at hand height, the same for everyone", () => {
    for (let i = 0; i < 26; i += 1) {
      for (let s = 0; s < 400; s += 13.7) {
        const f = fireflyAt(i, s);
        expect(Math.hypot(f.x, f.z)).toBeLessThan(FIREFLIES_AT.radius + 0.45);
        expect(f.y).toBeGreaterThan(0.6);
        expect(f.y).toBeLessThan(1.6);
      }
    }
    expect(fireflyAt(3, 99)).toEqual(fireflyAt(3, 99));
  });
});
