import { expect, test } from "vitest";
import { RainTexture } from "./rain-audio";

test("rain stays continuous across worklet blocks and never replays the old three-second loop", () => {
  const rate = 24000, length = rate * 12;
  const whole = new RainTexture(rate, 42), blocked = new RainTexture(rate, 42);
  const left = new Float32Array(length), right = new Float32Array(length);
  whole.render(left, right);
  const chunk = new Float32Array(128), other = new Float32Array(128);
  for (let i = 0; i < length; i += 128) {
    const count = Math.min(128, length - i);
    blocked.render(chunk.subarray(0, count), other.subarray(0, count));
    expect(chunk.subarray(0, count)).toEqual(left.subarray(i, i + count));
    expect(other.subarray(0, count)).toEqual(right.subarray(i, i + count));
  }
  let energy = 0, repeatEnergy = 0, peak = 0, stereo = 0;
  for (let i = 0; i < length; i++) {
    expect(Number.isFinite(left[i])).toBe(true);
    energy += left[i] ** 2; peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
    stereo += (left[i] - right[i]) ** 2;
    if (i >= rate * 3) repeatEnergy += (left[i] - left[i - rate * 3]) ** 2;
  }
  expect(Math.sqrt(energy / length)).toBeGreaterThan(.05);
  expect(peak).toBeLessThan(1);
  expect(repeatEnergy / energy).toBeGreaterThan(1);
  expect(stereo / energy).toBeGreaterThan(.001);
});

test("new visits get different rain, with gentle rather than abrupt changes in the wash", () => {
  const rate = 24000, a = new RainTexture(rate, 10), b = new RainTexture(rate, 11);
  const left = new Float32Array(rate), right = new Float32Array(rate), second = new Float32Array(rate);
  const levels: number[] = [];
  for (let i = 0; i < 30; i++) {
    a.render(left, right);
    levels.push(Math.sqrt(left.reduce((sum, v) => sum + v * v, 0) / rate));
  }
  b.render(second, right);
  expect(second).not.toEqual(left);
  expect(Math.max(...levels) / Math.min(...levels)).toBeGreaterThan(1.05);
  for (let i = 1; i < levels.length; i++) expect(Math.abs(levels[i] / levels[i - 1] - 1)).toBeLessThan(.15);
});
