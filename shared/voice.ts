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
 * Returns null when it is fine. REFUSING rather than truncating is the same
 * rule the profile keys follow: silently shortening tells the sender their
 * words were used when they were not — and with speech the sender cannot hear
 * what actually came out, so they would never find out.
 */
export function refusalFor(input: UtteranceInput): string | null {
  const say = input.say?.trim() ?? "";
  const detail = input.detail?.trim() ?? "";

  if (!say && !detail) return "an utterance needs something in it";

  if (say.length > SPOKEN_LIMIT) {
    return (
      `that is ${say.length} characters to say out loud; the limit is ${SPOKEN_LIMIT}. ` +
      "Put the long version in `detail` — it is written down and not read aloud."
    );
  }
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
