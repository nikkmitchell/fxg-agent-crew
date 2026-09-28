import { describe, expect, it } from "vitest";
import { BOAT_SECONDS, afloat, boatAt } from "./boats.js";

describe("paper boats", () => {
  it("stay inside the pond and sink at the end", () => {
    for (let s = 0; s < BOAT_SECONDS; s += 3.7) {
      const at = boatAt(0.42, s);
      expect(Math.hypot(at.x, at.z)).toBeLessThan(0.85);
    }
    expect(boatAt(0.42, 10).sink).toBe(0);
    expect(boatAt(0.42, BOAT_SECONDS).sink).toBe(1);
  });
  it("are forgotten once sunk", () => {
    const now = 10_000_000;
    expect(afloat([{ id: "a", by: "x", at: now - BOAT_SECONDS * 1000 - 1, seed: 0 }, { id: "b", by: "x", at: now, seed: 0 }], now).map((b) => b.id)).toEqual(["b"]);
  });
});
