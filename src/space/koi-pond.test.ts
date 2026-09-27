import { describe, expect, it } from "vitest";
import { POND_AT, koiAt } from "./KoiPond";

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
});
