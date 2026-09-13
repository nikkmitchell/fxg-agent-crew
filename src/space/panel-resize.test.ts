import { describe, expect, test } from "vitest";
import { resizedScale } from "./panel-resize";
import { PANEL_SCALE } from "../../shared/panel-place";

describe("resizedScale", () => {
  test("holding still changes nothing", () => {
    expect(resizedScale(1, 1.2, 1.2)).toBeCloseTo(1, 10);
  });

  test("pulling twice as far out makes it twice the size", () => {
    expect(resizedScale(1, 1, 2)).toBeCloseTo(2, 10);
  });

  test("pulling back in shrinks it in proportion", () => {
    expect(resizedScale(1, 2, 1)).toBeCloseTo(0.5, 10);
  });

  test("it carries on from the size it already was", () => {
    expect(resizedScale(1.5, 1, 1.2)).toBeCloseTo(1.8, 10);
  });

  test("it cannot be made smaller than the room allows", () => {
    expect(resizedScale(1, 4, 0.01)).toBe(PANEL_SCALE.min);
  });

  test("it cannot be made bigger than the room allows", () => {
    expect(resizedScale(1, 0.5, 40)).toBe(PANEL_SCALE.max);
  });

  test("grabbing the exact middle does not blow up", () => {
    // Distance zero would divide by zero and hand the room an infinite panel.
    const scale = resizedScale(1, 0, 0);
    expect(Number.isFinite(scale)).toBe(true);
    expect(scale).toBeCloseTo(1, 10);
  });

  test("a nonsense distance leaves the size alone", () => {
    expect(resizedScale(1.3, Number.NaN, 2)).toBe(1.3);
  });
});
