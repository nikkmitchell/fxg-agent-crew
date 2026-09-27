/**
 * THE PRAYER WHEEL: a tall painted drum on a post that anyone pushes round.
 *
 * In Tibetan practice each turn of the wheel sends out the mantra written
 * inside it. Here a push is told to everyone in the room, whose wheel spins
 * with it, and the room counts every push, so the wheel shows how many times
 * it has been turned since the server last started.
 */

/** How hard a push can be, 0.2 to 1: a nudge or a proper spin. */
export function pushStrength(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0.6;
  return Math.min(1, Math.max(0.2, value));
}

/** One person cannot push faster than this. */
export const PUSH_REST_MS = 400;

/** The wheel's spin, in turns a second, `seconds` after a push of `strength`: slowing gently to rest. */
export function spinAfter(strength: number, seconds: number): number {
  return strength * 1.4 * Math.exp(-seconds / 6);
}

export type WheelPush = { by: string; strength: number; turns: number };
