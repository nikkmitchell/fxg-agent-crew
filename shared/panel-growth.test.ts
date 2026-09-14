import { describe, expect, it } from "vitest";
import { MAX_GROWTH, grownPanel } from "./panel-growth";

describe("the task board grows with its cards", () => {
  it("stays its set size while everything fits", () => {
    expect(grownPanel(2.6, 2.0)).toEqual({ height: 2.6, lift: 0 });
    expect(grownPanel(2.6, null)).toEqual({ height: 2.6, lift: 0 });
  });

  it("grows taller to fit, keeping its bottom edge where it was", () => {
    // Nikk: "so that its always long enough for all the tasks to be shown".
    const grown = grownPanel(2.6, 4.0);
    expect(grown.height).toBe(4.0);
    expect(-grown.height / 2 + grown.lift).toBeCloseTo(-2.6 / 2, 9);
  });

  it("stops at four times its set height", () => {
    expect(grownPanel(2.6, 100).height).toBeCloseTo(2.6 * MAX_GROWTH, 9);
  });
});
