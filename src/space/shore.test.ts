import { describe, expect, it } from "vitest";
import { WAVE_SECONDS, reachAt } from "./Shore";

describe("the shore", () => {
  it("rushes in, then slides back, once a wave", () => {
    expect(reachAt(0)).toBeCloseTo(0);
    expect(reachAt(WAVE_SECONDS * 0.33)).toBeCloseTo(1, 1);
    expect(reachAt(WAVE_SECONDS * 0.99)).toBeLessThan(0.1);
    expect(reachAt(3.1)).toBeCloseTo(reachAt(3.1 + WAVE_SECONDS));
  });
});
