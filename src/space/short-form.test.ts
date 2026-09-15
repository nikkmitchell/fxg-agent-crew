import { describe, expect, it } from "vitest";
import { moreNote, shortForm, WALL_LIMIT } from "./short-form";

describe("shortening a chat message for the wall", () => {
  it("leaves a message that already fits completely alone", () => {
    expect(shortForm("deploy it")).toEqual({ shown: "deploy it", hiddenWords: 0 });
  });

  it("stops at the end of a sentence, never inside one", () => {
    const text = `${"Voice chat is live. ".repeat(20)}`;
    const { shown, hiddenWords } = shortForm(text);
    expect(shown.endsWith("live.")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(WALL_LIMIT);
    expect(hiddenWords).toBeGreaterThan(0);
  });

  it("never turns a refusal into agreement", () => {
    // The hazard that made this a boundary cut rather than a character count.
    const text = `I would not merge this until the migration is reversible. ${"Detail follows. ".repeat(30)}`;
    expect(shortForm(text).shown).toContain("I would not merge this");
  });

  it("keeps whole lines of a list rather than half of one", () => {
    const text = ["Everything shipped:", "  1. Agent homes, saved on the server", "  2. Quest typing", "  3. Baldman", "  4. The task board", "  5. Body tracking", "  6. Touching agents", "  7. Voice chat", "  8. Agent voices"].join("\n");
    const { shown } = shortForm(text);
    expect(shown.endsWith("\n")).toBe(false);
    // A number's full stop is not a sentence end, so no line is cut after "1."
    expect(shown).not.toMatch(/\d\.$/);
    expect(shown.split("\n").at(-1)).toMatch(/^ {2}\d\. \S/);
  });

  it("cuts one over-long sentence at a word, and says the sentence goes on", () => {
    const text = "a".concat(" word".repeat(200));
    const { shown, hiddenWords } = shortForm(text);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown).not.toMatch(/ word\w/);
    expect(hiddenWords).toBeGreaterThan(0);
  });

  it("counts what is left out, and says where to read it", () => {
    const { hiddenWords } = shortForm(`One sentence. ${"more words ".repeat(100)}`);
    expect(moreNote(hiddenWords)).toBe(`⋯ ${hiddenWords} more words — in chat`);
    expect(moreNote(1)).toBe("⋯ 1 more word — in chat");
    expect(moreNote(0)).toBeNull();
  });
});
