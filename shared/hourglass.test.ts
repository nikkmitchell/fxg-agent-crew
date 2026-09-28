import { describe, expect, it } from "vitest";
import { HOURGLASS_SECONDS, topAt, turnOver } from "./hourglass.js";

describe("the hourglass", () => {
  const ms = HOURGLASS_SECONDS * 1000;
  it("runs down over three minutes after it is turned", () => {
    const glass = turnOver({ turnedAt: null, topThen: 0 }, 0);
    expect(topAt(glass, 0)).toBe(1);
    expect(topAt(glass, ms / 2)).toBeCloseTo(0.5);
    expect(topAt(glass, ms * 2)).toBe(0);
  });
  it("turned mid-run, the fallen sand has to fall back", () => {
    const glass = turnOver({ turnedAt: null, topThen: 0 }, 0);
    const again = turnOver(glass, ms / 4);
    expect(topAt(again, ms / 4)).toBeCloseTo(0.25);
  });
});
