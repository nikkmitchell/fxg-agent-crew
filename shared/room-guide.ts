/**
 * THE ROOM GUIDE: what there is in meditation.AR and which way it is.
 *
 * In one night the room gained some twenty separate experiences (Nikk, 5484:
 * "a bunch, and they can be completely disconnected"). Someone arriving sees
 * the orb and has no way to know the tea table is behind them or the rain is
 * in the far corner. This lists each one with an arrow from where people
 * arrive (spawn (0, 6.2), facing -z toward the orb).
 *
 * Positions are copied from each piece's own constant; when one moves, move
 * it here too.
 */
export type GuideEntry = { name: string; x: number; z: number; what: string };

export const ARRIVAL = { x: 0, z: 6.2 } as const;

export const ROOM_GUIDE: readonly GuideEntry[] = [
  { name: "Breathing orb", x: 0, z: 4.7, what: "guided meditations, breathing, stones" },
  { name: "Stillness tree", x: -0.95, z: 4.55, what: "grows as the room breathes" },
  { name: "Reading stone", x: -1.35, z: 4.25, what: "old words read aloud" },
  { name: "Room's book", x: -1.25, z: 3.5, what: "sessions held here" },
  { name: "Sand garden", x: -2.2, z: 5.2, what: "rake it together" },
  { name: "Tea table", x: -1.7, z: 6.8, what: "one cup, slowly" },
  { name: "Labyrinth", x: 0, z: 8.6, what: "walk the path in" },
  { name: "Ikebana", x: 1.9, z: 7.9, what: "place a flower" },
  { name: "Singing bowls", x: 1.15, z: 4.2, what: "strike or circle the rim" },
  { name: "Candle shelf", x: 1.5, z: 3.5, what: "light one for someone" },
  { name: "Ember fire", x: 2.3, z: 5.5, what: "let something go" },
  { name: "Koi pond", x: 3.5, z: 4.4, what: "fish, water clock" },
  { name: "Gong", x: 3.7, z: 6.8, what: "strike it" },
  { name: "Incense", x: 0, z: 3.75, what: "a ten-minute timer" },
  { name: "Lanterns", x: 0.6, z: 2.6, what: "release one" },
  { name: "Hold the light", x: -0.4, z: 1.2, what: "a ball between your hands" },
  { name: "Practice panel", x: 4.8, z: 3.0, what: "grounding, noticing, one good thing" },
  { name: "Kaleidoscope dome", x: -2.8, z: 2.2, what: "walk inside" },
  { name: "Light ribbons", x: 2.9, z: 2.0, what: "move your hands slowly" },
  { name: "Rain curtain", x: 4.6, z: 0.6, what: "stand in the rain" },
  { name: "Sand mandala", x: -3.6, z: 7.2, what: "pour coloured sand" },
  { name: "Prayer wheel", x: -3.6, z: 4.5, what: "push it round" },
  { name: "Wind chimes", x: 0.9, z: 7.2, what: "walk under them" },
  { name: "Fireflies", x: -2.9, z: 6.3, what: "hold a hand still" },
  { name: "Mala", x: -1.6, z: 0.3, what: "count 108 breaths" },
  { name: "Floor harp", x: -2.5, z: 8.9, what: "walk across it" },
  { name: "Nebula", x: 4.2, z: 8.8, what: "put your hands in it" },
  { name: "Hourglass", x: 1.25, z: 6.05, what: "turn it for three minutes" },
  { name: "Offering light", x: 1.4, z: 0.2, what: "for two: stand either side" },
  { name: "Cairn", x: -4.5, z: 5.9, what: "add a stone" },
];

/**
 * Which way to go from where you arrive, facing the orb, IN WORDS: the room's
 * font has the straight arrows but not the diagonal ones, which came out as
 * empty boxes on the sign.
 */
export function arrowTo(entry: { x: number; z: number }, from: { x: number; z: number } = ARRIVAL): string {
  const dx = entry.x - from.x;
  const ahead = from.z - entry.z; // facing -z, so ahead is decreasing z
  const angle = Math.atan2(dx, ahead); // 0 ahead, +90° right
  const arrows = ["ahead", "ahead right", "right", "behind right", "behind", "behind left", "left", "ahead left"];
  const index = Math.round(((angle * 180) / Math.PI + 360) % 360 / 45) % 8;
  return arrows[index];
}

/** How far, in whole steps of about 0.7 m, rounded to be readable. */
export function stepsTo(entry: { x: number; z: number }, from: { x: number; z: number } = ARRIVAL): number {
  return Math.max(1, Math.round(Math.hypot(entry.x - from.x, entry.z - from.z) / 0.7));
}
