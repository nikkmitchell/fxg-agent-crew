import { describe, expect, it } from "vitest";
import { RIBBONS_AT, hueOf, inCircle } from "./LightRibbons";

describe("the light ribbons", () => {
  it("gives each person the same colour every time, and different people different ones", () => {
    expect(hueOf("Nikk2")).toBe(hueOf("nikk2"));
    expect(hueOf("Nikk2")).not.toBe(hueOf("baiwei2"));
    expect(hueOf("x")).toBeGreaterThanOrEqual(0);
    expect(hueOf("x")).toBeLessThan(1);
  });

  it("draws only for hands inside the circle", () => {
    expect(inCircle(RIBBONS_AT.x, RIBBONS_AT.z)).toBe(true);
    expect(inCircle(RIBBONS_AT.x + RIBBONS_AT.radius + 0.1, RIBBONS_AT.z)).toBe(false);
  });
});
