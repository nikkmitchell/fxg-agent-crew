import { describe, expect, it } from "vitest";
import { POND_AT, koiAt, koiClock, updateKoiPull } from "./KoiPond";

describe("the koi pond", () => {
  it("keeps every koi well inside the rim, at every moment", () => {
    for (let index = 0; index < 5; index += 1) {
      for (let seconds = 0; seconds < 600; seconds += 7.3) {
        const at = koiAt(index, seconds);
        expect(Math.hypot(at.x, at.z)).toBeLessThan(POND_AT.radius * 0.85);
      }
    }
  });

  it("shows everyone the same fish: a koi's place depends only on the clock", () => {
    expect(koiAt(2, 1234.5)).toEqual(koiAt(2, 1234.5));
    expect(koiAt(2, 1234.5)).not.toEqual(koiAt(2, 1240));
  });

  it("holds swimming and tail motion still for reduced-motion users", () => {
    expect(koiClock(1234.5, true)).toBe(koiClock(1240, true));
    expect(koiClock(1234.5)).not.toBe(koiClock(1240));
  });

  it("keeps hand attraction available but snaps instead of easing when reduced motion is on", () => {
    const pulled = { x: -0.2, z: 0.1 };
    updateKoiPull(pulled, { x: 0.3, z: -0.15 }, 1 / 60, true, true);
    expect(pulled).toEqual({ x: 0.3, z: -0.15 });
    updateKoiPull(pulled, { x: 0, z: 0 }, 1 / 60, false, true);
    expect(pulled).toEqual({ x: 0, z: 0 });
  });
});
