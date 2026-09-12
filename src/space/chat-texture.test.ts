import { describe, expect, it } from "vitest";
import { wrap } from "./chat-texture";

/**
 * Wrapping the chat panel's text.
 *
 * The only part of the canvas painting testable without a 2D context, so the
 * measuring is injected: this ruler says one character is one unit, which makes
 * every expectation below readable as a character count.
 */
const ruler = { measureText: (text: string) => ({ width: text.length }) };

describe("wrapping a message for the panel", () => {
  it("keeps a short line whole", () => {
    expect(wrap(ruler, "ship it", 40)).toEqual(["ship it"]);
  });

  it("breaks on words, not in the middle of them", () => {
    expect(wrap(ruler, "the quick brown fox jumps", 10)).toEqual([
      "the quick",
      "brown fox",
      "jumps",
    ]);
  });

  it("keeps a word longer than the line rather than losing it", () => {
    // Truncating here would silently drop the distinguishing end of a URL or an
    // actor id, which is exactly where the meaning lives.
    expect(wrap(ruler, "aaaaaaaaaaaaaaa", 5)).toEqual(["aaaaaaaaaaaaaaa"]);
  });

  it("honours the line breaks somebody typed", () => {
    expect(wrap(ruler, "one\ntwo", 40)).toEqual(["one", "two"]);
  });

  it("keeps an empty line that was deliberately there", () => {
    expect(wrap(ruler, "one\n\ntwo", 40)).toEqual(["one", "", "two"]);
  });

  it("returns one empty line for an empty message rather than nothing", () => {
    // A message with no body still needs a row, or its author's name would
    // appear attached to the next person's words.
    expect(wrap(ruler, "", 40)).toEqual([""]);
  });
});
