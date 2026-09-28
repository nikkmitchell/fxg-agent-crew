import { describe, expect, it } from "vitest";
import { dawnWarmthAt } from "./dawn.js";

const utc = (hour: number, minute = 0, day = 28) => Date.UTC(2026, 8, day, hour, minute);

describe("the shared daily dawn", () => {
  it("eases up over ten minutes, holds through the day, and settles at dusk", () => {
    expect(dawnWarmthAt(utc(5, 59))).toBe(0);
    expect(dawnWarmthAt(utc(6))).toBe(0);
    expect(dawnWarmthAt(utc(6, 5))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(utc(6, 10))).toBe(1);
    expect(dawnWarmthAt(utc(12))).toBe(1);
    expect(dawnWarmthAt(utc(18))).toBe(1);
    expect(dawnWarmthAt(utc(18, 5))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(utc(18, 10))).toBe(0);
    expect(dawnWarmthAt(utc(23, 59))).toBe(0);
  });

  it("repeats on the shared UTC clock and handles invalid timestamps safely", () => {
    expect(dawnWarmthAt(utc(6, 5, 29))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(Number.NaN)).toBe(0);
    expect(dawnWarmthAt(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("gives reduced-motion users a static endpoint instead of a moving sunrise", () => {
    expect(dawnWarmthAt(utc(6, 1), true)).toBe(1);
    expect(dawnWarmthAt(utc(6, 9), true)).toBe(1);
    expect(dawnWarmthAt(utc(12), true)).toBe(1);
    expect(dawnWarmthAt(utc(18, 5), true)).toBe(1);
    expect(dawnWarmthAt(utc(18, 10), true)).toBe(0);
    expect(dawnWarmthAt(utc(4), true)).toBe(0);
  });
});
