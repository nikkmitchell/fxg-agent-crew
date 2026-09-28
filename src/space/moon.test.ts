import { describe, expect, it } from "vitest";
import { moonArc, moonDisplayHour, moonPhase } from "./Moon";

describe("the moon", () => {
  it("knows a new moon and a full moon", () => {
    expect(moonPhase(Date.UTC(2000, 0, 6, 18, 14))).toBeCloseTo(0, 3);
    // 2024-04-23 23:49 UTC was a full moon.
    expect(Math.abs(moonPhase(Date.UTC(2024, 3, 23, 23, 49)) - 0.5)).toBeLessThan(0.02);
  });
  it("crosses the sky through the night, and is pale by day", () => {
    expect(moonArc(18)).toEqual({ across: 0, bright: 1 });
    expect(moonArc(0).across).toBeCloseTo(0.5);
    expect(moonArc(6)).toEqual({ across: 1, bright: 1 });
    expect(moonArc(12).bright).toBeLessThan(0.5);
  });

  it("freezes its current place when reduced motion is enabled", () => {
    expect(moonDisplayHour(22.5, 22.5, true)).toBe(22.5);
    expect(moonDisplayHour(23.5, 22.5, true)).toBe(22.5);
    expect(moonDisplayHour(23.5, null, false)).toBe(23.5);
  });
});
