import { describe, expect, test } from "vitest";
import { WRIST_BUTTON, stackedY } from "./Backdrop";

const STEP = WRIST_BUTTON.height + WRIST_BUTTON.gap;

describe("stackedY", () => {
  test("the last row sits exactly on the anchor", () => {
    expect(stackedY(4, 5)).toBe(0);
    expect(stackedY(0, 1)).toBe(0);
  });

  test("earlier rows stack above it, never below", () => {
    const ys = [0, 1, 2, 3].map((i) => stackedY(i, 4));
    expect(ys).toEqual([3 * STEP, 2 * STEP, STEP, 0]);
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(0);
  });

  test("the anchored row does not move when the list grows", () => {
    // The whole point: opening the menu adds rows ABOVE your hand, so the
    // button you just pressed is still the button under your finger.
    expect(stackedY(1, 2)).toBe(stackedY(9, 10));
  });

  test("rows are one button-and-gap apart", () => {
    expect(stackedY(0, 2) - stackedY(1, 2)).toBeCloseTo(STEP, 10);
  });
});
