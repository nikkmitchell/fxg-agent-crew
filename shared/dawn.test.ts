import { describe, expect, it } from "vitest";
import { dawnScheduleLabelAt, dawnWarmthAt } from "./dawn.js";

const utc = (hour: number, minute = 0, day = 28, month = 8) => Date.UTC(2026, month, day, hour, minute);

describe("the shared daily dawn", () => {
  it("rises at 22:00 UTC, holds over midnight, and settles at 10:00 UTC", () => {
    expect(dawnWarmthAt(utc(21, 59))).toBe(0);
    expect(dawnWarmthAt(utc(22))).toBe(0);
    expect(dawnWarmthAt(utc(22, 5))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(utc(22, 10))).toBe(1);
    expect(dawnWarmthAt(utc(23, 59))).toBe(1);
    expect(dawnWarmthAt(utc(0))).toBe(1);
    expect(dawnWarmthAt(utc(9, 59))).toBe(1);
    expect(dawnWarmthAt(utc(10))).toBe(1);
    expect(dawnWarmthAt(utc(10, 5))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(utc(10, 10))).toBe(0);
    expect(dawnWarmthAt(utc(21))).toBe(0);
  });

  it("repeats daily and safely handles invalid timestamps", () => {
    expect(dawnWarmthAt(utc(22, 5, 29))).toBeCloseTo(0.5, 2);
    expect(dawnWarmthAt(Number.NaN)).toBe(0);
    expect(dawnWarmthAt(Number.POSITIVE_INFINITY)).toBe(0);
    expect(dawnWarmthAt(Number.MAX_VALUE)).toBe(0);
  });

  it("labels the shared UTC hour with the viewer's local equivalent", () => {
    expect(dawnScheduleLabelAt(utc(12), "Asia/Shanghai")).toBe("22:00 UTC (06:00 your time)");
    expect(dawnScheduleLabelAt(utc(12), "America/New_York")).toBe("22:00 UTC (18:00 your time)");
    expect(dawnScheduleLabelAt(utc(12), "Mars/Phobos")).toBe("22:00 UTC");
    expect(dawnScheduleLabelAt(Number.MAX_VALUE, "Asia/Shanghai")).toBe("22:00 UTC");
  });

  it("uses the next day's UTC occurrence and accounts for the viewer's DST", () => {
    expect(dawnScheduleLabelAt(utc(12, 0, 7, 2), "America/New_York")).toBe("22:00 UTC (17:00 your time)");
    expect(dawnScheduleLabelAt(utc(12, 0, 8, 2), "America/New_York")).toBe("22:00 UTC (18:00 your time)");
  });

  it("gives reduced-motion users a static endpoint instead of either transition", () => {
    expect(dawnWarmthAt(utc(22, 1), true)).toBe(1);
    expect(dawnWarmthAt(utc(10, 5), true)).toBe(1);
    expect(dawnWarmthAt(utc(10, 10), true)).toBe(0);
    expect(dawnWarmthAt(utc(15), true)).toBe(0);
  });
});
