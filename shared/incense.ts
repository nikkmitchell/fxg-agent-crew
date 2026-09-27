/**
 * INCENSE: light a stick in the bowl behind the orb and it burns for ten
 * minutes, for everyone in the room: a thin thread of smoke curling up, the
 * glowing tip creeping down, the stick shorter each time you look. When it is
 * gone, ten minutes have passed: the oldest meditation timer there is.
 *
 * Kept by the server only while a stick is burning.
 */

export const INCENSE_SECONDS = 10 * 60;
/** The bowl holds this many sticks at once. */
export const MOST_STICKS = 5;
export const LIGHT_REST_MS = 10_000;

export type Stick = { id: string; by: string; at: number; slot: number };

/** How much of a stick is left at `now`, 1 to 0. */
export function leftOf(stick: Stick, now: number): number {
  return Math.max(0, 1 - (now - stick.at) / (INCENSE_SECONDS * 1000));
}

/** The sticks still burning. */
export function burning(sticks: readonly Stick[], now: number): Stick[] {
  return sticks.filter((stick) => leftOf(stick, now) > 0);
}

/** The first free place in the bowl, or null when it is full. */
export function freeSlot(sticks: readonly Stick[]): number | null {
  for (let slot = 0; slot < MOST_STICKS; slot += 1) if (!sticks.some((stick) => stick.slot === slot)) return slot;
  return null;
}
