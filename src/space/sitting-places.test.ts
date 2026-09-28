import { describe, expect, it } from "vitest";
import { CUSHIONS, sittingLine } from "./SittingPlaces";

describe("sitting places", () => {
  it("counts the minutes someone has been sitting", () => {
    expect(sittingLine(0, 30_000)).toBe("sitting");
    expect(sittingLine(0, 7 * 60_000 + 5)).toBe("sitting · 7 min");
  });
  it("puts the cushions in front of the orb, clear of the incense behind it", () => {
    for (const cushion of CUSHIONS) expect(cushion.z).toBeGreaterThan(4.7);
  });
});
