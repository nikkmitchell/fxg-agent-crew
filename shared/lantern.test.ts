import { describe, expect, it } from "vitest";
import { LANTERN_SECONDS, LANTERN_WORD, cleanWord, lanternAt, stillAloft } from "./lantern.js";

describe("floating lanterns", () => {
  it("rise, and fade out at the end of their time", () => {
    expect(lanternAt(0.3, 60).y).toBeGreaterThan(lanternAt(0.3, 10).y);
    expect(lanternAt(0.3, 10).glow).toBe(1);
    expect(lanternAt(0.3, LANTERN_SECONDS).glow).toBe(0);
  });
  it("carry one short line", () => {
    expect(cleanWord("  for   Mum \n")).toBe("for Mum");
    expect(cleanWord("x".repeat(99))).toHaveLength(LANTERN_WORD);
    expect(cleanWord(3)).toBe("");
  });
  it("are forgotten once they are out of the sky", () => {
    const now = 1_000_000_000;
    const lanterns = [
      { id: "old", by: "a", word: "", at: now - LANTERN_SECONDS * 1000 - 1, seed: 0 },
      { id: "new", by: "a", word: "", at: now - 1000, seed: 0 },
    ];
    expect(stillAloft(lanterns, now).map((one) => one.id)).toEqual(["new"]);
  });
});
