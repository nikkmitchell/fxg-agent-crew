import { expect, test } from "vitest";
import { RAIN_RETREAT, retreatDrops, retreatLevel } from "./rain-retreat";

test("rain falls around the sitter without passing through the dry center", () => {
  const drops = retreatDrops();
  expect(drops).toHaveLength(420);
  for (const drop of drops) {
    const distance = Math.hypot(drop.x, drop.z);
    expect(distance).toBeGreaterThanOrEqual(RAIN_RETREAT.inner);
    expect(distance).toBeLessThanOrEqual(RAIN_RETREAT.outer);
  }
  expect(retreatDrops()).toEqual(drops);
});
test("approach and departure keep the sound and visual field local", () => {
  expect(retreatLevel(0)).toBe(1);
  expect(retreatLevel(1.6)).toBe(1);
  expect(retreatLevel(3.1)).toBeCloseTo(.5);
  expect(retreatLevel(4.6)).toBeCloseTo(0);
  expect(retreatLevel(12)).toBe(0);
});
