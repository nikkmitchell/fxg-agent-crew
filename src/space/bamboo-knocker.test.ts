import { describe, expect, it } from "vitest";
import { CYCLE_SECONDS, KNOCK_AT, tiltAt } from "./BambooKnocker";

describe("the shishi-odoshi", () => {
  it("rests while it fills, tips to pour, and falls back to knock", () => {
    const resting = tiltAt(1);
    const tipped = tiltAt(CYCLE_SECONDS - 1.6 + 0.7);
    expect(tipped).toBeGreaterThan(resting + 0.5);
    expect(tiltAt(KNOCK_AT + 0.01)).toBeCloseTo(tiltAt(0.001), 1);
  });
  it("is the same for everyone at the same moment", () => {
    expect(tiltAt(123456.7)).toBe(tiltAt(123456.7 + CYCLE_SECONDS));
  });
});
