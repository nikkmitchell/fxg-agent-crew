/**
 * WHERE YOU ARRIVE IN A SPACE: beside whoever is already there, not inside them.
 *
 * A space puts its camera where people should start, so everyone started on
 * the same spot: the second person stood inside the first, with the first
 * one's name tag filling the view, until somebody walked away (Kerf, 2026-10-14,
 * testing kerf.light with two people). On arrival, if somebody already stands
 * within `clear` metres of the spot, you arrive a step to one side: right or
 * left of where the space faces you first, so you join a line rather than block
 * anybody's view, then further round, then a ring further out.
 */
export type Spot = { x: number; z: number };

/** Directions to try, in the frame of where you face: x to your right, z behind you. */
const AROUND: Array<[number, number]> = [
  [1, 0], [-1, 0], [0.71, 0.71], [-0.71, 0.71], [0.71, -0.71], [-0.71, -0.71], [0, 1], [0, -1],
];

export function arrivalSpot(spot: Spot, others: Spot[], yaw: number, clear = 0.8): Spot {
  const free = (x: number, z: number) => others.every((other) => Math.hypot(other.x - x, other.z - z) >= clear);
  if (free(spot.x, spot.z)) return spot;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  for (const radius of [0.9, 1.8, 2.7]) {
    for (const [right, back] of AROUND) {
      // Turned by yaw about the vertical, as three.js turns an object by rotation.y.
      const x = spot.x + (right * cos + back * sin) * radius;
      const z = spot.z + (-right * sin + back * cos) * radius;
      if (free(x, z)) return { x, z };
    }
  }
  return spot;
}
