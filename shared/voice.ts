/**
 * What can be said in the room, and how much of it is spoken aloud.
 *
 * THE SHAPE IS THE RULE. An utterance has a short part that a voice reads out
 * and a long part that is only ever written down. Speaking at a person and
 * explaining to a colleague are different acts, and giving them one field would
 * have made brevity depend on everyone remembering to be brief.
 *
 * Shared so the browser and the server agree on the cap. A limit enforced on
 * one side only is a limit the other side discovers by being refused.
 */

/**
 * The longest thing anybody may say out loud, in characters.
 *
 * Roughly eight seconds of speech. The number is a judgement rather than a
 * measurement, and it is deliberately short: a person wearing a headset cannot
 * skim, cannot re-read, and cannot skip ahead. Anything that wants more room
 * belongs in `detail`, where it can be read at whatever speed the reader likes.
 */
export const SPOKEN_LIMIT = 240;

/**
 * Split something too long to say into the part that is said and the rest.
 *
 * NOBODY IS REFUSED FOR LENGTH ANY MORE. Nikk, blocked mid-sentence by the old
 * behaviour: "ok i just got a message sending bug. 'that is 353 characters to
 * say out loud, the limiti is...' please remove any limit here."
 *
 * The old rule refused, and argued for it: "REFUSING rather than truncating is
 * the same rule the profile keys follow: silently shortening tells the sender
 * their words were used when they were not — and with speech the sender cannot
 * hear what actually came out, so they would never find out." Every word of
 * that is about DISCARDING words. It is right about that and it chose the wrong
 * remedy: refusing does not save the sentence, it throws the whole thing away
 * and makes the person say it again, shorter, into a headset they cannot type
 * into.
 *
 * SO NOTHING IS DISCARDED AND NOTHING IS REFUSED. The opening is spoken, the
 * remainder is written down beside it, and the speaker keeps every word. That
 * is not truncation — truncation loses the end, and this puts the end where it
 * can be read.
 *
 * IT CUTS AT A SENTENCE, NEVER MID-SENTENCE, which is the part that matters.
 * Stopping mid-clause is how "I would not merge this" becomes "I would", and
 * then the room really has said something nobody said. If the first sentence
 * alone is longer than the cap, the whole thing goes to `detail` and nothing is
 * spoken: better silent than misquoted.
 */
export function splitSpoken(text: string, limit = SPOKEN_LIMIT): { say?: string; detail?: string } {
  const words = text.trim();
  if (!words) return {};
  if (words.length <= limit) return { say: words };

  // Sentence ends, in order, with the punctuation kept on the spoken half.
  const ends: number[] = [];
  const pattern = /[.!?…]+[\s"')\]]*/g;
  for (let match = pattern.exec(words); match; match = pattern.exec(words)) {
    ends.push(match.index + match[0].trimEnd().length);
  }
  const fits = ends.filter((end) => end <= limit);
  if (fits.length === 0) {
    // One very long sentence. Say nothing rather than half of it.
    return { detail: words };
  }
  const cut = fits[fits.length - 1];
  return { say: words.slice(0, cut).trim(), detail: words.slice(cut).trim() };
}

/** The longest written part. Generous — nobody has to listen to it. */
export const DETAIL_LIMIT = 20_000;

export type UtteranceInput = {
  /** Spoken aloud. Omit for something written and not said. */
  say?: string;
  /** Written down, never spoken. Omit when the words were the whole of it. */
  detail?: string;
  /**
   * Who it is aimed at. Omitted means the room heard it and nobody in
   * particular was addressed — which is not the same as addressing everybody.
   */
  to?: string;
  /** How it arrived. A transcript is a guess; typed text is not. */
  source: "voice" | "text";
  /** Recognition confidence, when there was one. Only ever shown, never used to hide. */
  confidence?: number;
};

export type Utterance = {
  id: number;
  at: string;
  actorId: string;
  to: string | null;
  say: string | null;
  detail: string | null;
  source: "voice" | "text";
  confidence: number | null;
};

/**
 * Why an utterance was refused, in the sender's terms.
 *
 * Returns null when it is fine.
 *
 * LENGTH IS NOT A REFUSAL ANY MORE. This used to say: "REFUSING rather than
 * truncating is the same rule the profile keys follow: silently shortening
 * tells the sender their words were used when they were not — and with speech
 * the sender cannot hear what actually came out, so they would never find
 * out." That is a correct worry about DISCARDING words, and refusal was the
 * wrong answer to it — it discards all of them and makes somebody in a headset
 * say the whole thing again. `splitSpoken` keeps every word instead.
 *
 * Everything else here still refuses, because the rest are real faults rather
 * than a sentence being long.
 */
export function refusalFor(input: UtteranceInput): string | null {
  const say = input.say?.trim() ?? "";
  const detail = input.detail?.trim() ?? "";

  if (!say && !detail) return "an utterance needs something in it";

  // NO LONGER REFUSED FOR LENGTH. `splitSpoken` puts the overflow in `detail`
  // instead, so a long sentence costs a reader nothing and a speaker nothing.
  // See the note on that function for why refusing was the wrong remedy for a
  // right concern.
  if (detail.length > DETAIL_LIMIT) {
    return `that detail is ${detail.length} characters; the limit is ${DETAIL_LIMIT}`;
  }
  if (input.confidence !== undefined) {
    if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
      return "confidence must be a number between 0 and 1";
    }
    if (input.source !== "voice") return "only a transcript has a confidence";
  }
  return null;
}
