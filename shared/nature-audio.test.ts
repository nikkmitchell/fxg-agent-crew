import { expect, test } from "vitest";
import { NatureTexture } from "./nature-audio";
import { natureLevel, natureSeeds } from "./nature-retreat";

test("clearings reveal locally and all wandering lights start clear of the floor", () => {
  expect(natureLevel(0)).toBe(1); expect(natureLevel(1.6)).toBe(1);
  expect(natureLevel(3.3)).toBeCloseTo(.5); expect(natureLevel(5)).toBe(0);
  for (const seed of natureSeeds("fireflies", 72)) {
    expect(seed.y).toBeGreaterThanOrEqual(.4);
    expect(Math.hypot(seed.x, seed.z)).toBeLessThanOrEqual(2.8);
  }
});
for (const kind of ["sakura", "fireflies"] as const) {
  test(`${kind} sound is bounded, continuous across blocks and has no repeating clip`, () => {
    const rate = 24000, count = rate * 10;
    const a = new NatureTexture(rate, kind, 98), b = new NatureTexture(rate, kind, 98);
    const left = new Float32Array(count), right = new Float32Array(count), block = new Float32Array(128), other = new Float32Array(128);
    a.render(left, right);
    for (let i = 0; i < count; i += 128) {
      const size = Math.min(128, count - i);
      b.render(block.subarray(0, size), other.subarray(0, size));
      expect(block.subarray(0, size)).toEqual(left.subarray(i, i + size));
    }
    let energy = 0, repeatEnergy = 0;
    for (let i = 0; i < count; i++) {
      expect(Number.isFinite(left[i])).toBe(true); expect(Math.abs(left[i])).toBeLessThan(.5);
      energy += left[i] ** 2;
      if (i >= rate * 3) repeatEnergy += (left[i] - left[i - rate * 3]) ** 2;
    }
    expect(energy).toBeGreaterThan(1); expect(repeatEnergy / energy).toBeGreaterThan(1);
  });
}
