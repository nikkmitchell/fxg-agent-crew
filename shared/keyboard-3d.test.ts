import { describe, expect, it } from "vitest";
import { KEY, buildKeyboard, emptyTyping, keyAt, press, type Typing } from "./keyboard-3d.js";

/**
 * The keyboard, tested without a headset.
 *
 * Same reason as the board: which key is under a finger has to be the same
 * question the renderer answered when it drew that key. If the two disagree,
 * typing produces the letter next to the one you pressed, which is maddening
 * and looks like bad tracking rather than bad arithmetic.
 */

const type = (text: string, start: Typing = emptyTyping()): Typing => {
  let state = start;
  for (const character of text) {
    const board = buildKeyboard(state.mode, state.shifted);
    // Case-insensitive: with shift held the key's value is already uppercase,
    // which is the point of shift and not a reason the helper cannot find it.
    const key = board.keys.find(
      (k) => k.value.toLowerCase() === character.toLowerCase() || (k.action === "space" && character === " "),
    );
    if (!key) throw new Error(`no key for ${JSON.stringify(character)}`);
    state = press(state, key);
  }
  return state;
};

describe("the layout", () => {
  it("has every letter, once", () => {
    const keys = buildKeyboard().keys.filter((k) => !k.action).map((k) => k.value);
    expect(new Set(keys).size).toBe(keys.length);
    for (const letter of "qwertyuiopasdfghjklzxcvbnm") expect(keys).toContain(letter);
  });

  it("has the keys you cannot type without", () => {
    const actions = buildKeyboard().keys.map((k) => k.action).filter(Boolean);
    expect(actions).toEqual(expect.arrayContaining(["shift", "backspace", "space", "enter", "symbols"]));
  });

  it("reaches numbers and punctuation through symbols", () => {
    const symbols = buildKeyboard("symbols").keys.map((k) => k.value);
    for (const character of "1234567890") expect(symbols).toContain(character);
    expect(symbols).toContain("?");
    expect(symbols).toContain(".");
  });

  it("never overlaps two keys", () => {
    // Overlapping keys means a press that is genuinely ambiguous, and the
    // padding below would make it worse rather than better.
    const { keys } = buildKeyboard();
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const a = keys[i];
        const b = keys[j];
        const apart =
          Math.abs(a.x - b.x) >= (a.width + b.width) / 2 - 1e-9 ||
          Math.abs(a.y - b.y) >= (a.height + b.height) / 2 - 1e-9;
        expect(apart, `${a.label} overlaps ${b.label}`).toBe(true);
      }
    }
  });

  it("keeps every key inside the keyboard", () => {
    /**
     * A SEPARATE TEST FROM OVERLAP, and I only learned why by breaking it.
     *
     * Laying the bottom row out left to right makes overlap impossible by
     * construction, so widening a key can no longer make two keys collide — it
     * pushes the rest of the row off the right-hand edge instead, silently,
     * while the overlap test stays green. A key drawn outside the panel is a
     * key nobody can press. Bounds is the failure mode the new layout has, so
     * bounds is what has to be checked.
     */
    for (const mode of ["letters", "symbols"] as const) {
      const board = buildKeyboard(mode);
      for (const key of board.keys) {
        expect(key.x - key.width / 2, `${key.label} off the left`).toBeGreaterThanOrEqual(-board.width / 2 - 1e-9);
        expect(key.x + key.width / 2, `${key.label} off the right`).toBeLessThanOrEqual(board.width / 2 + 1e-9);
      }
    }
  });

  it("staggers rows rather than making a grid", () => {
    // A grid of identical squares gives a finger nothing to aim by.
    const { keys } = buildKeyboard();
    const rowY = [...new Set(keys.filter((k) => !k.action).map((k) => Number(k.y.toFixed(4))))];
    const firstOf = (y: number) => Math.min(...keys.filter((k) => Number(k.y.toFixed(4)) === y).map((k) => k.x));
    expect(firstOf(rowY[0])).not.toBeCloseTo(firstOf(rowY[1]), 4);
  });
});

describe("finding the key under a finger", () => {
  it("finds the key the renderer drew there", () => {
    const board = buildKeyboard();
    for (const key of board.keys) {
      expect(keyAt(board, { x: key.x, y: key.y })?.label, `centre of ${key.label}`).toBe(key.label);
    }
  });

  it("is forgiving at the edges, because a fingertip is not precise", () => {
    // A keyboard that only registers dead centre feels broken, not precise.
    const board = buildKeyboard();
    const key = board.keys.find((k) => k.value === "g")!;
    const justOutside = key.x + key.width / 2 + KEY.hitPadding * 0.8;
    expect(keyAt(board, { x: justOutside, y: key.y })?.value).toBe("g");
  });

  it("still returns nothing in the space between rows", () => {
    const board = buildKeyboard();
    const a = board.keys.find((k) => k.value === "q")!;
    expect(keyAt(board, { x: a.x, y: a.y - (KEY.size / 2 + KEY.gap / 2) })).toBeNull();
  });

  it("returns nothing off the keyboard", () => {
    expect(keyAt(buildKeyboard(), { x: 99, y: 99 })).toBeNull();
  });
});

describe("typing", () => {
  it("writes what you press", () => {
    expect(type("hello").text).toBe("hello");
  });

  it("puts spaces in", () => {
    expect(type("a b").text).toBe("a b");
  });

  it("SHIFT IS ONE-SHOT, like a phone", () => {
    // A sticky shift means looking at the keyboard to find out what state it is
    // in, which is the thing you cannot do while typing.
    const board = buildKeyboard();
    const shift = board.keys.find((k) => k.action === "shift")!;
    let state = press(emptyTyping(), shift);
    expect(state.shifted).toBe(true);
    state = type("ab", state);
    expect(state.text).toBe("Ab");
    expect(state.shifted).toBe(false);
  });

  it("backspaces", () => {
    const board = buildKeyboard();
    const backspace = board.keys.find((k) => k.action === "backspace")!;
    expect(press(type("cat"), backspace).text).toBe("ca");
  });

  it("backspacing an empty field does nothing rather than throwing", () => {
    const backspace = buildKeyboard().keys.find((k) => k.action === "backspace")!;
    expect(press(emptyTyping(), backspace).text).toBe("");
  });

  it("switches to symbols and back", () => {
    const letters = buildKeyboard();
    const toSymbols = letters.keys.find((k) => k.action === "symbols")!;
    const state = press(emptyTyping(), toSymbols);
    expect(state.mode).toBe("symbols");
    expect(press(state, buildKeyboard("symbols").keys.find((k) => k.action === "symbols")!).mode).toBe("letters");
  });

  it("stops at the limit rather than growing forever", () => {
    // A title that never stops is a texture that never fits.
    let state = emptyTyping("x".repeat(280));
    const board = buildKeyboard();
    state = press(state, board.keys.find((k) => k.value === "a")!, 280);
    expect(state.text).toHaveLength(280);
    state = press(state, board.keys.find((k) => k.action === "space")!, 280);
    expect(state.text).toHaveLength(280);
  });

  it("finishes on done, and says it was cancelled when cancelled", () => {
    const board = buildKeyboard();
    expect(press(type("hi"), board.keys.find((k) => k.action === "enter")!).done).toBe(true);
    expect(press(type("hi"), { ...board.keys[0], action: "cancel" }).cancelled).toBe(true);
  });

  it("starts from existing text, for editing rather than only writing", () => {
    expect(type(" more", emptyTyping("already")).text).toBe("already more");
  });
});
