/**
 * THE HOURGLASS: three minutes of sand. Turn it over and the sand runs down
 * for everyone in the room; the simplest timer for a short sit, and one you
 * can see from your cushion. Turning it mid-run turns it over as it is, the
 * way a real one does: what had fallen now has to fall back.
 */

export const HOURGLASS_SECONDS = 180;

/** The glass: when it was last turned, and how much sand was in the top then (0..1). */
export type Hourglass = { turnedAt: number | null; topThen: number };

/** How much sand is in the top at `now`, 0..1. */
export function topAt(glass: Hourglass, now: number): number {
  if (glass.turnedAt === null) return 0;
  return Math.max(0, glass.topThen - (now - glass.turnedAt) / (HOURGLASS_SECONDS * 1000));
}

/** Turn it over at `now`: whatever was in the bottom is now in the top. */
export function turnOver(glass: Hourglass, now: number): Hourglass {
  return { turnedAt: now, topThen: 1 - topAt(glass, now) };
}
