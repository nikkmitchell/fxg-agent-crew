import { describe, expect, it } from "vitest";
import { backspaceIn, charAtPoint, dictateInto, draftAtEnd, tapAt, typeInto, wordAt, wordSpans, type DraftEdit } from "./draft-edit.js";

/**
 * Baiwei's own message, as the room wrote it down: "i just succeeded with
 * pulling task from review to dawn". "dawn" was "done". These are the presses
 * that fix it, without retyping the sentence.
 */
const SAID = "i just succeeded with pulling task from review to dawn on the task board";
const indexOf = (word: string, text = SAID) => text.indexOf(word);

describe("fixing one misheard word", () => {
  it("tap the word, say it again: only that word changes", () => {
    let state = draftAtEnd(SAID);
    state = tapAt(state, indexOf("dawn") + 1);
    expect(state.selected).toEqual({ start: indexOf("dawn"), end: indexOf("dawn") + 4 });
    state = dictateInto(state, "done");
    expect(state.text).toBe(SAID.replace("dawn", "done"));
  });

  it("tap the word, type: the first key replaces it and the rest follow", () => {
    let state = tapAt(draftAtEnd(SAID), indexOf("dawn"));
    for (const key of "done") state = typeInto(state, key);
    expect(state.text).toBe(SAID.replace("dawn", "done"));
    expect(state.selected).toBeNull();
  });

  it("tap the word, ⌫: it goes, with one space, and the sentence closes up", () => {
    let state = tapAt(draftAtEnd(SAID), indexOf("pulling"));
    state = backspaceIn(state);
    expect(state.text).toBe(SAID.replace("pulling ", ""));
    // The first word has no space before it; the one after goes instead.
    state = backspaceIn(tapAt(draftAtEnd(SAID), 0));
    expect(state.text).toBe(SAID.replace("i ", ""));
  });

  it("tapping the selected word again lets go of it and puts the caret after it, to type there", () => {
    let state = tapAt(draftAtEnd(SAID), indexOf("review"));
    state = tapAt(state, indexOf("review"));
    expect(state.selected).toBeNull();
    state = typeInto(state, "!");
    expect(state.text).toBe(SAID.replace("review", "review!"));
  });
});

describe("with nothing selected, it behaves as it always did", () => {
  it("keys and ⌫ work at the end", () => {
    let state = draftAtEnd("hello");
    state = typeInto(state, "!");
    state = backspaceIn(backspaceIn(state));
    expect(state.text).toBe("hell");
  });

  it("speaking again appends, spaced — typed half a title and spoke the rest", () => {
    expect(dictateInto(draftAtEnd("move the"), "card to done").text).toBe("move the card to done");
    expect(dictateInto(draftAtEnd(""), "hello").text).toBe("hello");
  });

  it("respects the limit, whether replacing or adding", () => {
    expect(typeInto(draftAtEnd("abc"), "d", 3).text).toBe("abc");
    const replaced = typeInto(tapAt(draftAtEnd("ab cd"), 0), "wxyz", 6);
    expect(replaced.text).toBe("wxy cd");
  });

  it("an empty draft has nothing to select", () => {
    expect(tapAt(draftAtEnd(""), 0)).toEqual(draftAtEnd(""));
    expect(backspaceIn(draftAtEnd(""))).toEqual(draftAtEnd(""));
  });
});

describe("finding the word under a tap", () => {
  it("knows the words, and on a space takes the nearer one", () => {
    expect(wordSpans("  a bb  ccc ")).toEqual([{ start: 2, end: 3 }, { start: 4, end: 6 }, { start: 8, end: 11 }]);
    expect(wordAt("ab  cd", 2)).toEqual({ start: 0, end: 2 });
    expect(wordAt("ab  cd", 3)).toEqual({ start: 4, end: 6 });
  });

  /** Troika's layout for "ab cd" on one line and "ef" on the next: 4 numbers per char. */
  const layout = (): number[] => {
    const chars: [number, number, number, number][] = [
      [0, 1, 0, 1], [1, 2, 0, 1], [2, 3, 0, 1], [3, 4, 0, 1], [4, 5, 0, 1], // "ab cd", line 1
      [5, 5, 0, 1],                                                          // the newline, at the end of line 1
      [0, 1, -2, -1], [1, 2, -2, -1],                                        // "ef", line 2
    ];
    return chars.flat();
  };

  it("finds the character on the nearest line, nearest by x", () => {
    expect(charAtPoint(layout(), 3.5, 0.5)).toBe(3);   // "c"
    expect(charAtPoint(layout(), 1.2, -1.6)).toBe(7);  // "f", line 2
    expect(charAtPoint(layout(), -3, 0.4)).toBe(0);    // left of the line: its first character
    expect(charAtPoint([], 0, 0)).toBeNull();
  });

  it("A CARET FROM ANOTHER FONT IS ON THE SAME LINE — the room's real numbers", () => {
    // Logged from a tap on "ab" in "ab cd▏", in the room: the caret glyph's
    // height is 0.006–0.042, the letters' 0–0.049. The first version chose the
    // caret (index 5), and so the word "cd".
    const real = [0, 0.02, 0, 0.049, 0.02, 0.042, 0, 0.049, 0.042, 0.052, 0, 0.049, 0.052, 0.069, 0, 0.049, 0.069, 0.091, 0, 0.049, 0.091, 0.127, 0.006, 0.042];
    expect(charAtPoint(real, 0.0183, 0.0224)).toBe(0); // "a"
    expect(charAtPoint(real, 0.08, 0.03)).toBe(4);     // "d"
    expect(charAtPoint(real, 0.11, 0.02)).toBe(5);     // the caret itself
  });

  it("goes from a tap on the text to the word, end to end", () => {
    const text = "ab cd\nef";
    const index = charAtPoint(layout(), 4.2, 0.6)!;
    expect(tapAt(draftAtEnd(text), index).selected).toEqual({ start: 3, end: 5 });
  });
});

describe("the caret never leaves the text", () => {
  it("clamps a caret past the end", () => {
    const state: DraftEdit = { text: "ab", caret: 99, selected: null };
    expect(typeInto(state, "c").text).toBe("abc");
    expect(backspaceIn(state).text).toBe("a");
  });
});
