/**
 * A long chat message, shortened for the wall in the room.
 *
 * Nikk, from the headset: agents should be "limited to a one-or-few-sentence
 * summary, with the full text still going to the main chat for deep
 * discussion". The room's wall painted the WebHarness feed verbatim, and an
 * agent's post runs 1,200 to 1,900 characters — one message filled the whole
 * panel, so standing at the wall showed you one paragraph instead of the
 * conversation. The same text on a laptop reads fine; it is the headset that
 * cannot skim it.
 *
 * NEVER CLIP MID-SENTENCE. Cutting to a character count turns "I would not
 * merge this" into "I would" and puts words in somebody's mouth that they did
 * not say. So the cut lands on a boundary somebody wrote: the end of a line, or
 * the end of a sentence. Only a first sentence longer than the whole budget is
 * cut at a word, and then it says so with an ellipsis.
 *
 * AND SAY THERE IS MORE, plainly — how much, and where to read it. A shortened
 * message that looks complete is worse than a long one.
 *
 * THE FULL TEXT IS NOT TOUCHED. This is the wall's drawing only: chat keeps
 * every word, which is the half of Nikk's ask that says "the full text still
 * going to the main chat".
 */

/**
 * How much of one message the wall shows. Roughly four lines at the panel's
 * text size — enough for the point of a post, short enough that three or four
 * people are on the wall at once.
 */
export const WALL_LIMIT = 260;

/** True at an index where the text ends a line or a sentence somebody wrote. */
function boundaryAt(text: string, index: number): boolean {
  const here = text[index];
  if (here === "\n") return true;
  if (here !== "." && here !== "!" && here !== "?") return false;
  // A stop is only a sentence end when something follows it and that something
  // is a break. "e.g." and "3.5" are not sentence ends, and neither is the "."
  // of a numbered list — which is why a digit before the stop does not count:
  // "  1. Home positions" would otherwise be a whole "sentence".
  const next = text[index + 1];
  if (next !== undefined && next !== " " && next !== "\n") return false;
  if (here === "." && /\d/.test(text[index - 1] ?? "")) return false;
  return true;
}

export type ShortForm = {
  /** What to draw. Never longer than the budget, never cut mid-sentence. */
  shown: string;
  /** How many words are not drawn. Zero when the whole message is shown. */
  hiddenWords: number;
};

const words = (text: string): number => (text.trim() === "" ? 0 : text.trim().split(/\s+/).length);

/** Shorten a message to whole lines or sentences that fit `limit`. */
export function shortForm(text: string, limit: number = WALL_LIMIT): ShortForm {
  const whole = text.trim();
  if (whole.length <= limit) return { shown: whole, hiddenWords: 0 };

  // The last boundary that fits. Scanning forward rather than searching
  // backwards keeps the "not a sentence end" rules in one place.
  let cut = -1;
  for (let i = 0; i < Math.min(whole.length, limit); i += 1) {
    if (boundaryAt(whole, i)) cut = i + 1;
  }

  if (cut <= 0) {
    // ONE SENTENCE, LONGER THAN THE BUDGET. Now a word boundary is the best
    // honest cut, and the ellipsis says the sentence does not end there.
    const space = whole.lastIndexOf(" ", limit);
    const at = space > limit / 2 ? space : limit;
    return { shown: `${whole.slice(0, at).trimEnd()}…`, hiddenWords: words(whole.slice(at)) };
  }

  return { shown: whole.slice(0, cut).trimEnd(), hiddenWords: words(whole.slice(cut)) };
}

/** The line drawn under a shortened message, or null when nothing was left out. */
export function moreNote(hiddenWords: number): string | null {
  if (hiddenWords <= 0) return null;
  return `⋯ ${hiddenWords} more ${hiddenWords === 1 ? "word" : "words"} — in chat`;
}
