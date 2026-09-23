import { describe, expect, it } from "vitest";
import { GO_SIZES } from "./room-items.js";
import { goBoardWidth, goBowl, goBowlScale } from "./go-layout.js";

/** The bowl's own outer radius at full size (the lathe profile's widest point). */
const BOWL_RADIUS = 0.18;

describe("bowls in proportion to the board", () => {
  it("full size at 19×19, smaller for smaller boards, never below 65%", () => {
    expect(goBowlScale(19)).toBeCloseTo(1, 9);
    const scales = [...GO_SIZES].sort((a, b) => a - b).map(goBowlScale);
    for (let i = 1; i < scales.length; i += 1) expect(scales[i]).toBeGreaterThanOrEqual(scales[i - 1]);
    for (const scale of scales) {
      expect(scale).toBeGreaterThanOrEqual(0.65);
      expect(scale).toBeLessThanOrEqual(1);
    }
    expect(goBowlScale(5)).toBeLessThan(0.8);
  });

  it("never reaches over the board's edge, at any size or seating", () => {
    for (const size of GO_SIZES) {
      for (let seats = 2; seats <= 8; seats += 1) {
        for (let colour = 0; colour < seats; colour += 1) {
          const bowl = goBowl(colour, seats, size);
          const edge = goBoardWidth(size) / 2;
          // Distance from the bowl's centre to the board square, minus the bowl.
          const outside = Math.max(Math.abs(bowl.x), Math.abs(bowl.z)) - edge;
          expect(outside - BOWL_RADIUS * goBowlScale(size), `${size}x${size} ${seats} seats bowl ${colour}`).toBeGreaterThan(0.05);
        }
      }
    }
  });
});
