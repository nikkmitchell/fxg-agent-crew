/**
 * PAPER BOATS on the koi pond: fold one, set it on the water, and it drifts
 * slowly round the pond among the fish for a few minutes, for everyone, then
 * softens and sinks. Kept by the server only while it floats.
 */

export const BOAT_SECONDS = 4 * 60;
export const MOST_BOATS = 12;
export const BOAT_REST_MS = 4_000;

export type Boat = { id: string; by: string; at: number; seed: number };

/**
 * Where a boat is on the pond `seconds` after it was set down, as a fraction
 * of the pond's radius from its middle, and which way it is pointing: a slow
 * wandering loop that never touches the rim.
 */
export function boatAt(seed: number, seconds: number): { x: number; z: number; heading: number; sink: number } {
  const t = seconds * (0.05 + seed * 0.03) + seed * 20;
  const x = Math.sin(t) * 0.55 + Math.sin(t * 2.3 + seed * 9) * 0.12;
  const z = Math.cos(t * 0.8) * 0.5 + Math.cos(t * 1.7 + seed * 5) * 0.1;
  const dt = 0.01;
  const x2 = Math.sin(t + dt) * 0.55 + Math.sin((t + dt) * 2.3 + seed * 9) * 0.12;
  const z2 = Math.cos((t + dt) * 0.8) * 0.5 + Math.cos((t + dt) * 1.7 + seed * 5) * 0.1;
  const sink = seconds > BOAT_SECONDS - 20 ? Math.min(1, (seconds - (BOAT_SECONDS - 20)) / 20) : 0;
  return { x, z, heading: Math.atan2(x2 - x, z2 - z), sink };
}

export function afloat(boats: readonly Boat[], now: number): Boat[] {
  return boats.filter((boat) => now - boat.at < BOAT_SECONDS * 1000).slice(-MOST_BOATS);
}
