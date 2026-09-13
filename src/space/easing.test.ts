import { describe, expect, test } from "vitest";
import { approachAngle } from "./easing";

describe("approachAngle", () => {
  test("reduced motion lands on the target immediately", () => {
    expect(approachAngle(0, 3, 8, 1 / 60, true)).toBe(3);
  });

  test("moves toward the target without overshooting it", () => {
    const next = approachAngle(0, 1, 8, 1 / 60, false);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(1);
  });

  test("takes the SHORT way round the circle", () => {
    // Just under a half-turn to just over it is a few degrees of real turning.
    // Interpolating the raw numbers spins the whole body the other way.
    const next = approachAngle(Math.PI - 0.05, -Math.PI + 0.05, 8, 1 / 60, false);
    expect(next).toBeGreaterThan(Math.PI - 0.05);
  });

  test("a big delta cannot overshoot", () => {
    expect(approachAngle(0, 1, 8, 10, false)).toBe(1);
  });

  test("settles exactly rather than creeping forever", () => {
    expect(approachAngle(1, 1.0001, 8, 1 / 60, false)).toBe(1.0001);
  });
});
