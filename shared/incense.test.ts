import { describe, expect, it } from "vitest";
import { INCENSE_SECONDS, MOST_STICKS, burning, freeSlot, leftOf } from "./incense.js";

describe("incense", () => {
  const now = 1_000_000;
  it("burns down over ten minutes", () => {
    const stick = { id: "a", by: "x", at: now, slot: 0 };
    expect(leftOf(stick, now)).toBe(1);
    expect(leftOf(stick, now + (INCENSE_SECONDS * 1000) / 2)).toBeCloseTo(0.5);
    expect(burning([stick], now + INCENSE_SECONDS * 1000 + 1)).toEqual([]);
  });
  it("takes the first free place in the bowl, and says when it is full", () => {
    expect(freeSlot([{ id: "a", by: "x", at: now, slot: 0 }])).toBe(1);
    expect(freeSlot(Array.from({ length: MOST_STICKS }, (_, slot) => ({ id: `${slot}`, by: "x", at: now, slot })))).toBeNull();
  });
});
