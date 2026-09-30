import { expect, test } from "vitest";
import { BOLIDE_CHANCE, meteorHeadGlow, meteorOpacity, meteorSpec, meteorTravel, nextMeteorDelay } from "./sky-meteors";

test("ordinary meteors are short varied streaks and bolides have a micro chance", () => {
  const normal = meteorSpec(() => .5);
  expect(normal.bolide).toBe(false);
  expect(normal.sweep).toBeLessThan(30);
  expect(BOLIDE_CHANCE).toBe(.001);
  const rare = meteorSpec(() => .0005);
  expect(rare.bolide).toBe(true);
  expect(rare.sweep).toBeGreaterThanOrEqual(150);
  expect(rare.duration).toBeGreaterThan(3);
});
test("there is no instantaneous flash at the beginning or end", () => {
  expect(meteorOpacity(0, 2)).toBe(0);
  expect(meteorOpacity(2.8, 2)).toBe(0);
  expect(meteorOpacity(1.4, 2)).toBeCloseTo(1);
  expect(meteorOpacity(2.4, 2)).toBeLessThan(.25);
  expect(meteorOpacity(1, 2)).toBeLessThan(meteorOpacity(1.4, 2));
  expect(nextMeteorDelay(() => 0)).toBe(45);
  expect(nextMeteorDelay(() => .5)).toBeGreaterThan(90);
});
test("shallow entries last longer and brighter heads vary between events", () => {
  const shallow = meteorSpec(() => 0, "meteor"), steep = meteorSpec(() => .99, "meteor");
  expect(shallow.inclination).toBeLessThan(steep.inclination);
  expect(shallow.duration).toBeGreaterThan(steep.duration);
  expect(shallow.curve).toBeGreaterThan(steep.curve);
  expect(shallow.strength).not.toBe(steep.strength);
  expect(shallow.peakBoost).toBeCloseTo(1.05);
  expect(steep.peakBoost).toBeGreaterThan(1.29);
  expect(steep.peakBoost).toBeLessThanOrEqual(1.30);
  expect(shallow.width).toBeGreaterThan(.03);
  expect(steep.sweep / steep.duration / (shallow.sweep / shallow.duration)).toBeLessThan(1.23);
});
test("the head burns out in flight while the residual trail still fades", () => {
  expect(meteorHeadGlow(1, 2)).toBeGreaterThan(meteorHeadGlow(.2, 2));
  expect(meteorHeadGlow(1.8, 2)).toBeLessThan(.5);
  expect(meteorHeadGlow(2, 2)).toBe(0);
  expect(meteorOpacity(2.1, 2)).toBeGreaterThan(0);
});
test("fading events keep travelling and each has a distinct peak along its flight", () => {
  expect(meteorTravel(2.4, 2)).toBeGreaterThan(meteorTravel(2, 2));
  const early = meteorSpec(() => 0, "meteor"), late = meteorSpec(() => .99, "meteor");
  expect(early.peak).toBeLessThan(late.peak);
  expect(meteorHeadGlow(3 * .3, 2, 1, .3)).toBeCloseTo(1.8);
  expect(meteorHeadGlow(3 * .6, 2, 1, .6)).toBeCloseTo(1.8);
  expect(meteorHeadGlow(2.4, 2, 1, .3)).toBeGreaterThan(0);
  expect(meteorHeadGlow(3, 2, 1, .3)).toBe(0);
  expect(meteorOpacity(.3, 2, 1, .3)).toBeLessThan(meteorOpacity(.9, 2, 1, .3));
  expect(meteorOpacity(2.4, 2, 1, .3)).toBeLessThan(meteorOpacity(.9, 2, 1, .3));
});
