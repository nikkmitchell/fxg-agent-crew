import { describe, expect, it } from "vitest";
import { crumbNote } from "./left-crumb";

/**
 * The sentence matters more than the mechanism here: it is read in a journal at
 * one in the morning by somebody deciding whether the bug is ours or the
 * browser's, and "reload" is the word that settles it.
 */
describe("what a page says about the one before it", () => {
  it("names a reload as something we did, in terms nobody has to interpret", () => {
    const note = crumbNote(2, "reload");
    expect(note).toContain("2s ago");
    expect(note).toContain("arrived by reload");
    expect(note).toContain("SOMETHING RELOADED THE PAGE UNDER A WEARER");
  });

  it("does not shout when the page was arrived at some other way", () => {
    // Taking the headset off and clicking a link is not a bug.
    expect(crumbNote(30, "navigate")).not.toContain("SOMETHING RELOADED");
    expect(crumbNote(30, "back_forward")).not.toContain("SOMETHING RELOADED");
  });

  it("says so plainly when the browser will not tell us how the page arrived", () => {
    expect(crumbNote(1, "unknown")).toContain("arrived by unknown");
  });
});
