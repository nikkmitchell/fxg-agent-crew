import { describe, expect, it } from "vitest";
import { TIDEPOOL_AT, glassRest, liftAt } from "./TidePool";

describe("the tide pool", () => {
  it("keeps every piece of glass inside the pool", () => {
    for (let i = 0; i < 7; i += 1) {
      const rest = glassRest(i);
      expect(Math.hypot(rest.x, rest.z)).toBeLessThan(TIDEPOOL_AT.radius - 0.05);
    }
  });
  it("rises, holds, and sinks back", () => {
    expect(liftAt(0)).toBe(0);
    expect(liftAt(4000)).toBe(1);
    expect(liftAt(20_000)).toBe(0);
  });
  it("snaps the selected glass into place without a rise or spin", () => {
    expect(liftAt(0, true)).toBe(1);
    expect(liftAt(4_000, true)).toBe(1);
    expect(liftAt(9_001, true)).toBe(0);
  });
});
