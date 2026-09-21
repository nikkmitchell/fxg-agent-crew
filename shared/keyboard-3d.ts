/**
 * A keyboard you can reach.
 *
 * WHY ONE EXISTS AT ALL. Adding a task, writing a comment and saying something
 * in chat all need text, and in an immersive session there is no DOM to type
 * into — no input, no system keyboard, nothing. The desktop has a real keyboard
 * and should keep using it; this is what makes the same actions possible in a
 * headset, so a feature does not exist in one room and not the other.
 *
 * SPEECH IS THE FASTER PATH AND IS ALREADY BUILT — the room transcribes with
 * whisper on the box. This is for the rest: a name, a correction, a short
 * title, and anything said in a room where other people can hear you.
 *
 * PURE, like the board geometry and for the same reason: which key is under a
 * finger has to be the same question the renderer answered when it drew the
 * key, and a test can ask it without a headset.
 */

export type Key = {
  /** What it puts in, or a named action. */
  value: string;
  label: string;
  /** Panel-local metres, centre of the key. */
  x: number;
  y: number;
  width: number;
  height: number;
  action?: "shift" | "backspace" | "space" | "enter" | "symbols" | "cancel";
};

export const KEY = {
  size: 0.055,
  gap: 0.008,
  /**
   * Keys are bigger than they look; a fingertip in a headset is not precise.
   *
   * UNDER HALF THE GAP, not under the gap. I wrote "smaller than the gap"
   * first, which lets two neighbours' padding meet in the middle — every point
   * between two keys then belongs to one of them and there is no miss, so a
   * finger in the crack silently types the key to its left. Half the gap, less
   * a hair, keeps a real gap in the middle.
   */
  hitPadding: 0.003,
} as const;

const ROWS_LETTERS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
const ROWS_SYMBOLS = ["1234567890", "-/:;()£&@", ".,?!'\""];

export type KeyboardMode = "letters" | "symbols";

export type Keyboard = {
  keys: Key[];
  width: number;
  height: number;
};

/**
 * Build the layout.
 *
 * ROWS ARE INDENTED like a real keyboard rather than a grid, because a grid of
 * identical squares gives a finger nothing to aim by and every key feels the
 * same. The muscle memory of a qwerty stagger is worth more than the tidiness.
 */
export function buildKeyboard(mode: KeyboardMode = "letters", shifted = false): Keyboard {
  const rows = mode === "letters" ? ROWS_LETTERS : ROWS_SYMBOLS;
  const unit = KEY.size + KEY.gap;
  const width = 10 * unit;
  const keys: Key[] = [];

  rows.forEach((row, rowIndex) => {
    const indent = (10 - row.length) / 2;
    [...row].forEach((character, index) => {
      const value = shifted && mode === "letters" ? character.toUpperCase() : character;
      keys.push({
        value,
        label: value,
        x: (indent + index) * unit + KEY.size / 2 - width / 2,
        y: -rowIndex * unit,
        width: KEY.size,
        height: KEY.size,
      });
    });
  });

  /**
   * The bottom row: the things that are not letters, wider because they are
   * pressed by feel rather than aimed at.
   *
   * LAID OUT LEFT TO RIGHT, one after another. The first version placed the
   * outer keys from each edge and space in the middle, and the middle did not
   * add up — `123` and `space` overlapped by eleven millimetres, which means a
   * press in that strip is genuinely ambiguous and whichever key the search
   * happened to reach first would win. Running the row from one end makes the
   * arithmetic impossible to get wrong: space is simply what is left.
   */
  const bottom = -3 * unit;
  const wide = KEY.size * 2 + KEY.gap;
  const spaceWidth = width - 4 * wide - 4 * KEY.gap;
  const row: { value: string; label: string; width: number; action: Key["action"] }[] = [
    { value: "shift", label: "⇧", width: wide, action: "shift" },
    { value: "symbols", label: mode === "letters" ? "123" : "abc", width: wide, action: "symbols" },
    { value: " ", label: "space", width: spaceWidth, action: "space" },
    { value: "backspace", label: "⌫", width: wide, action: "backspace" },
    { value: "enter", label: "done", width: wide, action: "enter" },
  ];
  let cursor = -width / 2;
  for (const item of row) {
    keys.push({
      value: item.value,
      label: item.label,
      x: cursor + item.width / 2,
      y: bottom,
      width: item.width,
      height: KEY.size,
      action: item.action,
    });
    cursor += item.width + KEY.gap;
  }

  return { keys, width, height: 4 * unit };
}

/**
 * The key under a point, in panel-local metres.
 *
 * PADDED. A fingertip in a headset lands a few millimetres from where its owner
 * believes it did, and a keyboard that only registers dead centre feels broken
 * rather than precise. The padding cannot overlap a neighbour because it is
 * smaller than the gap.
 */
export function keyAt(keyboard: Keyboard, point: { x: number; y: number }): Key | null {
  return (
    keyboard.keys.find(
      (key) =>
        Math.abs(point.x - key.x) <= key.width / 2 + KEY.hitPadding &&
        Math.abs(point.y - key.y) <= key.height / 2 + KEY.hitPadding,
    ) ?? null
  );
}

export type Typing = { text: string; mode: KeyboardMode; shifted: boolean; done: boolean; cancelled: boolean };

export const emptyTyping = (text = ""): Typing => ({ text, mode: "letters", shifted: false, done: false, cancelled: false });

/**
 * Apply a key.
 *
 * SHIFT IS ONE-SHOT, like a phone: it capitalises the next letter and releases.
 * A sticky shift in a headset means looking at the keyboard to find out what
 * state it is in, which is exactly the thing you cannot do while typing.
 */
export function press(state: Typing, key: Key, limit = 280): Typing {
  switch (key.action) {
    case "shift":
      return { ...state, shifted: !state.shifted };
    case "symbols":
      return { ...state, mode: state.mode === "letters" ? "symbols" : "letters", shifted: false };
    case "backspace":
      return { ...state, text: state.text.slice(0, -1) };
    case "enter":
      return { ...state, done: true };
    case "cancel":
      return { ...state, cancelled: true };
    case "space":
      return state.text.length >= limit ? state : { ...state, text: `${state.text} ` };
    default: {
      if (state.text.length >= limit) return state;
      return { ...state, text: state.text + key.value, shifted: false };
    }
  }
}
