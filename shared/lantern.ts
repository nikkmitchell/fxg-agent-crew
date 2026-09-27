/**
 * FLOATING LANTERNS: release a paper lantern, with a word if you like, and it
 * rises slowly into the dark above the room, drifting and glowing, until it is
 * too high and far to see. Everyone in the room sees every lantern.
 *
 * Kept by the server only while they are still in the sky, so somebody who
 * arrives sees the lanterns already rising; after that they are gone.
 */

/** How long a lantern is in the sky, from release to gone. */
export const LANTERN_SECONDS = 8 * 60;
/** The longest word a lantern carries. */
export const LANTERN_WORD = 24;
/** The most lanterns in one room's sky at once. */
export const MOST_LANTERNS = 40;
/** One person releases at most one lantern this often. */
export const LANTERN_REST_MS = 5_000;

export type Lantern = { id: string; by: string; word: string; at: number; seed: number };

export function cleanWord(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, LANTERN_WORD) : "";
}

/**
 * Where a lantern is `seconds` after it was released, from where it was let go:
 * rising, slowing a little, drifting on a slow wind that is different for each.
 */
export function lanternAt(seed: number, seconds: number): { x: number; y: number; z: number; glow: number } {
  const t = Math.max(0, seconds);
  const drift = 0.05 + seed * 0.05;
  const wind = seed * Math.PI * 2;
  return {
    x: Math.cos(wind) * drift * t + Math.sin(t * 0.3 + seed * 9) * 0.25,
    y: 1.3 + 0.35 * t - 0.00025 * t * t,
    z: Math.sin(wind) * drift * t + Math.cos(t * 0.27 + seed * 7) * 0.25,
    glow: t > LANTERN_SECONDS - 60 ? Math.max(0, (LANTERN_SECONDS - t) / 60) : 1,
  };
}

/** The lanterns still in the sky at `now`, newest last, at most MOST_LANTERNS. */
export function stillAloft(lanterns: readonly Lantern[], now: number): Lantern[] {
  return lanterns.filter((one) => now - one.at < LANTERN_SECONDS * 1000).slice(-MOST_LANTERNS);
}
