import { expect, test } from "vitest";
import { BOLIDE_CHANCE, meteorOpacity, meteorSpec, nextMeteorDelay } from "./sky-meteors";

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
  expect(meteorOpacity(2, 2)).toBe(1);
  expect(meteorOpacity(2.4, 2)).toBeCloseTo(.5);
  expect(meteorOpacity(1, 2)).toBe(1);
  expect(nextMeteorDelay(() => 0)).toBe(45);
  expect(nextMeteorDelay(() => .5)).toBeGreaterThan(90);
});
test("shallow entries last longer and brighter heads vary between events", () => {
  const shallow = meteorSpec(() => 0, "meteor"), steep = meteorSpec(() => .99, "meteor");
  expect(shallow.inclination).toBeLessThan(steep.inclination);
  expect(shallow.duration).toBeGreaterThan(steep.duration);
  expect(shallow.curve).toBeGreaterThan(steep.curve);
  expect(shallow.strength).not.toBe(steep.strength);
  expect(shallow.width).toBeGreaterThan(.03);
});
