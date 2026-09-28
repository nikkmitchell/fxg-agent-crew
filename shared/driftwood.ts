/**
 * DRIFTWOOD at the shore: tap a word and it is written on a piece of wood
 * lying at the water's edge; the next wave lifts it and carries it out, and it
 * is gone. Like the ember fire, NOTHING IS KEPT: the server tells the room and
 * forgets. See src/space/Shore.tsx.
 */

/** Words you can simply tap. Gentler than the fire's: things to send, not burn. */
export const DRIFT_WORDS = ["thanks", "hope", "rest", "home", "sorry", "yes"] as const;
/** How long one person waits before sending another. */
export const DRIFT_REST_MS = 4_000;
/** The total lifetime of a driftwood note, including its still resting period. */
export const DRIFT_LIFETIME_SECONDS = 10.5;

export type Drift = { by: string; word: string; at: number };

export function cleanDrift(word: unknown): string | null {
  if (typeof word !== "string") return null;
  const one = word.replace(/\s+/g, " ").trim().slice(0, 24);
  return one.length > 0 ? one : null;
}

/**
 * Where the wood is `seconds` after it was written: resting on the sand for a
 * moment, then drawn out to sea (along -1 = out) while bobbing and fading.
 * `out` is metres from where it lay; `fade` goes 1 to 0.
 */
export function driftAt(seconds: number, reducedMotion = false): { out: number; bob: number; fade: number } {
  if (reducedMotion) return seconds < DRIFT_LIFETIME_SECONDS ? { out: 0, bob: 0, fade: 1 } : { out: 0, bob: 0, fade: 0 };
  const rest = 2.5;
  if (seconds < rest) return { out: 0, bob: 0, fade: 1 };
  const t = seconds - rest;
  return { out: Math.min(1.4, t * 0.18), bob: Math.sin(t * 2.4) * 0.01, fade: Math.max(0, 1 - t / 8) };
}
