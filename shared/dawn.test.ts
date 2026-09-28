import { describe, expect, it } from "vitest";
import { DAWN_TIME_ZONE, dawnWarmthAt } from "./dawn.js";

const shanghai = (hour: number, minute = 0, day = 28) => Date.UTC(2026, 8, day, hour - 8, minute);

describe("the shared daily dawn", () => {
  it("eases up over ten minutes, holds through the day, and settles at dusk", () => {
    expect(dawnWarmthAt(shanghai(5, 59))).toBe(0);
    expect(dawnWarmthAt(shanghai(6))).toBe(0);
    expect(dawnWarmthAt(shanghai(6, 5))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(shanghai(6, 10))).toBe(1);
    expect(dawnWarmthAt(shanghai(12))).toBe(1);
    expect(dawnWarmthAt(shanghai(18))).toBe(1);
    expect(dawnWarmthAt(shanghai(18, 5))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(shanghai(18, 10))).toBe(0);
    expect(dawnWarmthAt(shanghai(23, 59))).toBe(0);
  });

  it("uses one named room timezone, repeats daily, and handles invalid inputs safely", () => {
    expect(DAWN_TIME_ZONE).toBe("Asia/Shanghai");
    expect(dawnWarmthAt(shanghai(6, 5, 29))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(Number.NaN)).toBe(0);
    expect(dawnWarmthAt(Number.POSITIVE_INFINITY)).toBe(0);
    expect(dawnWarmthAt(Number.MAX_VALUE)).toBe(0);
    expect(dawnWarmthAt(shanghai(6, 5), false, "Mars/Phobos")).toBe(0);
  });

  it("keeps the room's local 06:00 aligned across a DST change", () => {
    expect(dawnWarmthAt(Date.UTC(2026, 2, 8, 10, 5), false, "America/New_York")).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(Date.UTC(2026, 10, 1, 11, 5), false, "America/New_York")).toBeCloseTo(0.5, 2);
  });

  it("gives reduced-motion users a static endpoint instead of a moving sunrise", () => {
    expect(dawnWarmthAt(shanghai(6, 1), true)).toBe(1);
    expect(dawnWarmthAt(shanghai(6, 9), true)).toBe(1);
    expect(dawnWarmthAt(shanghai(12), true)).toBe(1);
    expect(dawnWarmthAt(shanghai(18, 5), true)).toBe(1);
    expect(dawnWarmthAt(shanghai(18, 10), true)).toBe(0);
    expect(dawnWarmthAt(shanghai(4), true)).toBe(0);
  });
});
