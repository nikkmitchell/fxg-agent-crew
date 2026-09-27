import { describe, expect, it } from "vitest";
import { CHIME_NOTES, stirFor } from "./WindChimes";

describe("the wind chimes", () => {
  it("stir most for someone right under them, and not at all from across the room", () => {
    expect(stirFor(0)).toBe(1);
    expect(stirFor(0.6)).toBeCloseTo(0.5);
    expect(stirFor(3)).toBe(0);
  });

  it("are tuned high and rising", () => {
    for (let i = 1; i < CHIME_NOTES.length; i += 1) expect(CHIME_NOTES[i]).toBeGreaterThan(CHIME_NOTES[i - 1]);
  });
});
