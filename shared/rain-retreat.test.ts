import { expect, test } from "vitest";
import { RAIN_RETREAT, retreatDrops, retreatLevel } from "./rain-retreat";
import { TIDAL_CLEARING, TIDAL_RAIN } from "./tidal-layout";
import { skyProximity } from "./earth-sky";

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
test("rain and sky are independent places with no overlapping reveal zone", () => {
  const gap = Math.hypot(TIDAL_RAIN.x - TIDAL_CLEARING.x, TIDAL_RAIN.z - TIDAL_CLEARING.z);
  expect(gap).toBeGreaterThan(5 + 4.6 + 2);
  expect(skyProximity(gap)).toBe(0);
  expect(retreatLevel(gap)).toBe(0);
  // Even the stone's wider base remains comfortably inside the dry circle.
  expect(RAIN_RETREAT.inner - .65).toBeGreaterThanOrEqual(.19);
});
test("approach and departure keep the sound and visual field local", () => {
  expect(retreatLevel(0)).toBe(1);
  expect(retreatLevel(1.6)).toBe(1);
  expect(retreatLevel(3.1)).toBeCloseTo(.5);
  expect(retreatLevel(4.6)).toBeCloseTo(0);
  expect(retreatLevel(12)).toBe(0);
});
