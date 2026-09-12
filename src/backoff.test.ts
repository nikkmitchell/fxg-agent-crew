import { describe, expect, it } from "vitest";
import { backoff } from "./backoff";

describe("waiting before a retry", () => {
  it("waits a second before the first retry", () => {
    expect(backoff(1, 30_000)).toBe(1_000);
  });

  it("doubles each time", () => {
    expect([2, 3, 4, 5].map((n) => backoff(n, 60_000))).toEqual([2_000, 4_000, 8_000, 16_000]);
  });

  it("stops at the cap, and stays there", () => {
    expect(backoff(20, 30_000)).toBe(30_000);
    expect(backoff(2_000, 30_000)).toBe(30_000);
    // A tab left open all weekend must not compute 2 to the power of a million
    // on its way to the same answer.
    expect(Number.isFinite(backoff(1e9, 15_000))).toBe(true);
  });

  it("honours the two different caps the app actually uses", () => {
    // The socket comes back quickly because somebody is standing in a room
    // waiting for it; the long poll does not, because a minute of failure is
    // rarely fixed by another second.
    expect(backoff(99, 30_000)).toBe(30_000);
    expect(backoff(99, 15_000)).toBe(15_000);
  });

  it("never returns less than the first delay, whatever it is given", () => {
    for (const attempt of [1, 0, -5, 0.5]) {
      expect(backoff(attempt, 30_000)).toBeGreaterThanOrEqual(1_000);
    }
  });
});
