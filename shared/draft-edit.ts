/**
 * Correcting what you said, a word at a time.
 *
 * Baiwei, in a headset: "when I record a voice message, and system writes it
 * down. But then I want to edit it. And instead of seeing everything I said, I
 * only see an empty bar with a keyboard... I would like to see everything that
 * I've said."
 *
 * The empty bar was the Quest's own keyboard, which can only ADD: Meta
 * documents that each time it opens, "any key press first overwrites the
 * entire existing value", so system-keyboard.ts deliberately opens it empty and
 * appends. It can never fix a word. The room's own typing panel has no such
 * rule, but its only key for fixing was ⌫ at the end.
 *
 * So: the whole message is shown, and TAPPING A WORD SELECTS IT. The next key
 * replaces it, ⌫ removes it, and speaking replaces just that word — a misheard
 * "dawn" becomes "done" in two presses, without retyping the sentence. With
 * nothing selected everything behaves as it always did, at the end.
 *
 * PURE: text, a caret and an optional selected word in, the same out.
 */

export type Span = { start: number; end: number };

/** The text being edited, where typing goes, and the word selected by a tap (if any). */
export type DraftEdit = { text: string; caret: number; selected: Span | null };

export const draftAtEnd = (text: string): DraftEdit => ({ text, caret: text.length, selected: null });

/** Every word: a run of anything but whitespace. */
export function wordSpans(text: string): Span[] {
  const spans: Span[] = [];
  const pattern = /\S+/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    spans.push({ start: match.index, end: match.index + match[0].length });
  }
  return spans;
}

/** The word at a character index — or, on a space, the nearer word either side. */
export function wordAt(text: string, index: number): Span | null {
  const spans = wordSpans(text);
  if (spans.length === 0) return null;
  let best = spans[0];
  let bestDistance = Infinity;
  for (const span of spans) {
    if (index >= span.start && index < span.end) return span;
    const distance = index < span.start ? span.start - index : index - (span.end - 1);
    if (distance < bestDistance) {
      best = span;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Which character a point on the text is over, from troika's layout:
 * `caretPositions` holds four numbers per character — left x, right x,
 * bottom y and top y, in the text's own frame.
 *
 * A LINE IS THE CHARACTERS WHOSE HEIGHTS OVERLAP, not the ones whose middles
 * are equal. The first version matched middles exactly, and the caret "▏"
 * comes from a fallback font with its own ascent: its height sat slightly off
 * the letters' on the very same line, counted as a line of its own, and was nearer
 * a tap on the first word than that word's own line — so tapping "ab" in
 * "ab cd▏" chose the caret, and the word beside it. Seen in the room, with the
 * numbers logged from the tap; the test below replays them.
 */
export function charAtPoint(caretPositions: ArrayLike<number>, x: number, y: number): number | null {
  const count = Math.floor(caretPositions.length / 4);
  if (count === 0) return null;
  const low = (i: number) => Math.min(caretPositions[i * 4 + 2], caretPositions[i * 4 + 3]);
  const high = (i: number) => Math.max(caretPositions[i * 4 + 2], caretPositions[i * 4 + 3]);
  const offBy = (i: number) => (y < low(i) ? low(i) - y : y > high(i) ? y - high(i) : 0);
  // The character nearest the tap vertically (inside its height counts as 0)…
  let anchor = 0;
  for (let i = 1; i < count; i += 1) if (offBy(i) < offBy(anchor) - 1e-9) anchor = i;
  // …names the line: everything whose height overlaps that character's.
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let i = 0; i < count; i += 1) {
    if (Math.min(high(i), high(anchor)) - Math.max(low(i), low(anchor)) <= 0) continue;
    const left = Math.min(caretPositions[i * 4], caretPositions[i * 4 + 1]);
    const right = Math.max(caretPositions[i * 4], caretPositions[i * 4 + 1]);
    const distance = x < left ? left - x : x > right ? x - right : 0;
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * A tap on the text. On a word: select it. On the word already selected: let
 * go of it and put the caret after it, so a second tap means "type here".
 */
export function tapAt(state: DraftEdit, index: number): DraftEdit {
  const word = wordAt(state.text, index);
  if (!word) return { ...state, caret: state.text.length, selected: null };
  const same = state.selected && state.selected.start === word.start && state.selected.end === word.end;
  return same ? { ...state, caret: word.end, selected: null } : { ...state, caret: word.end, selected: word };
}

const clampCaret = (state: DraftEdit) => Math.max(0, Math.min(state.caret, state.text.length));

/** A key: replaces the selected word, or goes in at the caret. */
export function typeInto(state: DraftEdit, chars: string, limit = Infinity): DraftEdit {
  if (!chars) return state;
  const { start, end } = state.selected ?? { start: clampCaret(state), end: clampCaret(state) };
  const room = limit - (state.text.length - (end - start));
  if (room <= 0) return state;
  const put = chars.slice(0, room);
  return { text: state.text.slice(0, start) + put + state.text.slice(end), caret: start + put.length, selected: null };
}

/** ⌫: removes the selected word and one space beside it, or the character before the caret. */
export function backspaceIn(state: DraftEdit): DraftEdit {
  if (state.selected) {
    let { start, end } = state.selected;
    if (start > 0 && state.text[start - 1] === " ") start -= 1;
    else if (state.text[end] === " ") end += 1;
    return { text: state.text.slice(0, start) + state.text.slice(end), caret: start, selected: null };
  }
  const caret = clampCaret(state);
  if (caret === 0) return { ...state, caret, selected: null };
  return { text: state.text.slice(0, caret - 1) + state.text.slice(caret), caret: caret - 1, selected: null };
}

/**
 * Words that were spoken. Selected: they replace that word — saying it again
 * is how you fix a word the machine misheard. Otherwise they go in at the
 * caret, spaced from their neighbours; at the end that is what speaking always
 * did — appended to what was already there.
 */
export function dictateInto(state: DraftEdit, words: string, limit = Infinity): DraftEdit {
  const said = words.trim();
  if (!said) return state;
  if (state.selected) return typeInto(state, said, limit);
  const caret = clampCaret(state);
  const before = state.text.slice(0, caret);
  const after = state.text.slice(caret);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const trail = after && !/^\s/.test(after) ? " " : "";
  return typeInto({ ...state, caret, selected: null }, `${lead}${said}${trail}`, limit);
}
