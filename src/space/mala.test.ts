import { describe, expect, it } from "vitest";
import { BEADS, beadAt } from "./MalaStand";

describe("the mala", () => {
  it("hangs the guru bead at the bottom, and turns one bead per count", () => {
    const guru = beadAt(0, 0);
    expect(guru.x).toBeCloseTo(0);
    expect(beadAt(1, 1).x).toBeCloseTo(guru.x);
    expect(beadAt(1, 1).y).toBeCloseTo(guru.y);
    expect(beadAt(5, BEADS).y).toBeCloseTo(beadAt(5, 0).y);
  });
});
