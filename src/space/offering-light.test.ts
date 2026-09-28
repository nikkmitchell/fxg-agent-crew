import { describe, expect, it } from "vitest";
import { nextPlace } from "./OfferingLight";

describe("the offering light (Inkstone, 5549)", () => {
  it("goes half way when offered, and waits", () => {
    expect(nextPlace(0, -1)).toBe(0.5);
    expect(nextPlace(0, 1)).toBe(-0.5);
  });
  it("is drawn in by the one it was offered to, who can offer it back", () => {
    const offered = nextPlace(0, -1); // toward the right person
    const taken = nextPlace(offered, 1); // they draw it in
    expect(taken).toBeCloseTo(0.9);
    expect(nextPlace(taken, 1)).toBe(-0.5); // and offer it back
  });
  it("cannot be snatched back across the stone", () => {
    expect(nextPlace(0.5, -1)).toBe(0.5);
  });
  it("stays where it is when nobody reaches", () => {
    expect(nextPlace(0.5, null)).toBe(0.5);
  });
});
