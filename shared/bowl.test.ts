import { describe, expect, it } from "vitest";
import { BOWL_NOTES, BOWL_REST_MS, bowlNote, mayStrike } from "./bowl.js";

describe("the singing bowl", () => {
  it("rings only its own notes, and picks one when not asked", () => {
    expect(bowlNote(220)).toBe(220);
    expect(bowlNote(9999, () => 0)).toBe(BOWL_NOTES[0]);
    expect(bowlNote("loud", () => 0.99)).toBe(BOWL_NOTES[BOWL_NOTES.length - 1]);
  });

  it("lets each person strike again only after a pause, and others at once", () => {
    const last = new Map([["nikk2", 1_000]]);
    expect(mayStrike(last, "Nikk2", 1_000 + BOWL_REST_MS - 1)).toBe(false);
    expect(mayStrike(last, "Nikk2", 1_000 + BOWL_REST_MS)).toBe(true);
    expect(mayStrike(last, "wilson", 1_001)).toBe(true);
  });
});
