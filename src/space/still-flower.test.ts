import { describe, expect, it } from "vitest";
import { OPEN_SECONDS, flowerDisplayOpen, openStep } from "./StillFlower";

describe("the still flower", () => {
  it("opens over a minute of stillness", () => {
    let open = 0;
    for (let t = 0; t < OPEN_SECONDS * 10; t += 1) open = openStep(open, 0.0005, 0.1, true);
    expect(open).toBe(1);
  });
  it("closes faster than it opens when you move, and when you leave", () => {
    expect(openStep(0.5, 0.05, 0.1, true)).toBeLessThan(0.5 - 0.1 / OPEN_SECONDS);
    expect(openStep(0.5, 0, 0.1, false)).toBeLessThan(0.5);
  });
  it("preserves stillness tracking but shows reduced-motion opening in one completed step", () => {
    expect(flowerDisplayOpen(0.99, true)).toBe(0);
    expect(flowerDisplayOpen(1, true)).toBe(1);
    expect(flowerDisplayOpen(0.4)).toBe(0.4);
  });
});
