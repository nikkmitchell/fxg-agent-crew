import { describe, expect, it } from "vitest";
import { RAIN_AT, rainLevel } from "./RainCurtain";

describe("the rain curtain", () => {
  it("is loudest inside and fades to nothing two metres out", () => {
    expect(rainLevel(0)).toBe(1);
    expect(rainLevel(RAIN_AT.radius + 1)).toBeCloseTo(0.5);
    expect(rainLevel(RAIN_AT.radius + 3)).toBe(0);
  });
});
