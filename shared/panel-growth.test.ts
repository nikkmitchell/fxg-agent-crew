import { describe, expect, it } from "vitest";
import { MAX_GROWTH, grownPanel, naturalHeight } from "./panel-growth";

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

describe("how tall a stretched board really is", () => {
  it("takes off the empty space every column shares, so a panel can shrink back", () => {
    // The board fills its window. A 1200 px page whose fullest column still
    // has 300 px spare needs 900 px, not the 1200 it is drawn at.
    expect(naturalHeight(1200, [300, 850, 1000])).toBe(900);
  });

  it("is the page height when some column is full, or when there are no columns", () => {
    expect(naturalHeight(1600, [0, 400])).toBe(1600);
    expect(naturalHeight(800, [])).toBe(800);
    expect(naturalHeight(800, [-5, 20])).toBe(800);
  });
});
