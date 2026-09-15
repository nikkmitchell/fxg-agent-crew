import { describe, expect, it } from "vitest";
import { wrapLabel } from "./label-texture";

/** A ruler that says a line fits when it has at most this many characters. */
const upTo = (characters: number) => (line: string) => line.length <= characters;

describe("wrapping a label onto its lines", () => {
  it("keeps a line break the caller wrote", () => {
    // The recording status is two lines on purpose.
    expect(wrapLabel("● Recording\n◼ sends   ✕ cancels", 2, upTo(40))).toEqual(["● Recording", "◼ sends ✕ cancels"]);
  });

  it("wraps a sentence at words", () => {
    expect(wrapLabel("Sent to the room and the chat.", 2, upTo(16))).toEqual(["Sent to the room", "and the chat."]);
  });

  it("marks what did not fit instead of dropping it silently", () => {
    expect(wrapLabel("one two three four five six", 2, upTo(8))).toEqual(["one two", "three…"]);
    expect(wrapLabel("first\nsecond\nthird", 2, upTo(40))).toEqual(["first", "second…"]);
  });

  it("keeps a single word wider than a line whole", () => {
    expect(wrapLabel("unbreakable", 2, upTo(4))).toEqual(["unbreakable"]);
  });
});
