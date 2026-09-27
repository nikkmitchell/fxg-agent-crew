/**
 * THE EMBER FIRE: a small fire you sit round, and a place to let go.
 *
 * Offer the fire a word (a worry, a grudge, a tiredness) and everyone in the
 * room sees it rise out of the flames, glow, and burn away into sparks.
 *
 * NOTHING IS KEPT, on purpose: letting go is the point, so the server
 * relays the word to whoever is in the room at that moment and forgets it.
 * No log, no history, no "who burned what" later.
 */

/** The longest word, or short phrase, the fire takes. */
export const OFFERING_LONGEST = 40;
/** How long one person waits before offering again. */
export const OFFER_REST_MS = 3_000;

/** Words you can simply tap, for a headset where typing is slow. */
export const READY_WORDS = ["worry", "fear", "anger", "doubt", "tiredness", "regret"] as const;

export type Offering = { by: string; word: string; at: number };

/** The word as the fire takes it: one line, trimmed, not too long. Null when empty. */
export function cleanOffering(word: unknown): string | null {
  if (typeof word !== "string") return null;
  const one = word.replace(/\s+/g, " ").trim().slice(0, OFFERING_LONGEST);
  return one.length > 0 ? one : null;
}

/**
 * Where a spark is `seconds` after the word began to burn: rising, drifting
 * sideways with a little swirl, slowing as it cools. `seed` is 0..1 per spark.
 */
export function sparkAt(seed: number, seconds: number): { x: number; y: number; z: number; glow: number } {
  const angle = seed * Math.PI * 2;
  const spread = 0.05 + seed * 0.12;
  const rise = 0.55 * seconds - 0.06 * seconds * seconds;
  const swirl = Math.sin(seconds * 2.2 + angle) * 0.04;
  return {
    x: Math.cos(angle) * spread * seconds + swirl,
    y: Math.max(0, rise),
    z: Math.sin(angle) * spread * seconds,
    glow: Math.max(0, 1 - seconds / (2.2 + seed * 1.4)),
  };
}
