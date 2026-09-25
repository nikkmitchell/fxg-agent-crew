import { describe, expect, it } from "vitest";
import { GO_RING, GO_ROCK_REACH, GO_SURFACE, goBowl, goBowlScale, goPoint } from "./go-layout.js";
import { createGoRockField, goRockHoles, goRockOutline } from "./go-rock.js";
import { GO_SIZES } from "./room-items.js";

describe("the scholar's rock", () => {
  for (const size of GO_SIZES) {
    it(`${size}: keeps every intersection flat, solid below and clear above`, () => {
      const field = createGoRockField(size);
      for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
        const x = goPoint(col, size), z = goPoint(row, size);
        expect(field(x, GO_SURFACE, z)).toBeCloseTo(0, 8);
        expect(field(x, GO_SURFACE - 0.015, z)).toBeLessThan(0);
        expect(field(x, GO_SURFACE + 0.015, z)).toBeGreaterThan(0);
      }
    });
    it(`${size}: has real open chimneys connected to side grottoes`, () => {
      const field = createGoRockField(size);
      for (const hole of goRockHoles(size)) {
        for (let y = GO_RING.y; y <= GO_SURFACE + 0.04; y += 0.008) {
          expect(field(hole.centre.x, y, hole.centre.z)).toBeGreaterThan(0);
        }
        for (let out = 0; out < 0.13; out += 0.008) {
          expect(field(hole.centre.x - Math.sin(hole.angle) * out,
            GO_RING.y + 0.048, hole.centre.z + Math.cos(hole.angle) * out)).toBeGreaterThan(0);
        }
      }
    });
    it(`${size}: keeps every bowl clear for two to eight players`, () => {
      for (let count = 2; count <= 8; count++) for (let i = 0; i < count; i++) {
        const bowl = goBowl(i, count, size, GO_ROCK_REACH);
        const gap = Math.min(...goRockOutline(size).map((p) => Math.hypot(p.x - bowl.x, p.z - bowl.z)));
        expect(gap - 0.18 * goBowlScale(size)).toBeGreaterThan(0.01);
      }
    });
  }
  it("is deterministic", () => {
    expect(goRockOutline(19)).toEqual(goRockOutline(19));
    expect(goRockHoles(9)).toEqual(goRockHoles(9));
  });
});
