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
});
