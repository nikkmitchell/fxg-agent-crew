/**
 * WHERE A PERSON APPEARS WHEN THEY JOIN A ROOM. Nikk (2026-09-28): "when
 * people join a room or when they join the lobby, they spawn in the middle.
 * Can we adjust it so that when people join a space they do not join overtop
 * of another human or agent or board ... one meter away from anything else."
 *
 * The spawn point is kept when it is clear. Otherwise the nearest spot on
 * rings around it that is a metre from every person and agent, and a metre
 * from every board (a board is its footprint on the floor, a line segment).
 */

export const ARRIVAL_CLEARANCE = 1.0;
const RING_STEP = 0.6;
const RINGS = 6;
const PER_RING = 12;

export type Point = { x: number; z: number };
/** A board's footprint on the floor: the line from one end to the other. */
export type Segment = { ax: number; az: number; bx: number; bz: number };

export function distanceToSegment(p: Point, s: Segment): number {
  const vx = s.bx - s.ax;
  const vz = s.bz - s.az;
  const length = vx * vx + vz * vz;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - s.ax) * vx + (p.z - s.az) * vz) / length));
  return Math.hypot(p.x - (s.ax + t * vx), p.z - (s.az + t * vz));
}

export function isClearForArrival(spot: Point, others: readonly Point[], boards: readonly Segment[]): boolean {
  return others.every((other) => Math.hypot(spot.x - other.x, spot.z - other.z) >= ARRIVAL_CLEARANCE)
    && boards.every((board) => distanceToSegment(spot, board) >= ARRIVAL_CLEARANCE);
}

/**
 * Which way round a ring is tried. FORWARD (the room's): from the way the
 * spawn faces, alternating sides, so a crowd at the door spreads inward.
 * BESIDE (a space's): right, then left, then working round both sides, so a
 * newcomer joins a line beside the first person instead of standing in the
 * view the space's author set up (Kerf, src/kit/arrive.ts, 2026-10-14).
 */
export type FirstStep = "forward" | "beside";

/** Turns from the first direction, in twelfths of a circle, for each way of trying. */
const ORDER: Record<FirstStep, readonly number[]> = {
  forward: [0, -1, 1, -2, 2, -3, 3, -4, 4, -5, 5, 6],
  // Right, its mirror on the left, then outward on both sides; all twelve once.
  beside: [0, 6, -1, 7, 1, 5, -2, 8, 2, 4, -3, 3],
};

/**
 * The spot to appear at: `spawn` if it is clear, else the nearest clear spot
 * around it, else `spawn`. ONE RULE for the room and for spaces (the kit
 * calls it with the space's facing and "beside"); it was two until 2026-10-22.
 *
 * `facing` is the spawn's rotation.y as three.js turns an object: 0 faces -z,
 * which is the room's door looking in.
 */
export function arrivalSpot(
  spawn: Point,
  others: readonly Point[],
  boards: readonly Segment[] = [],
  options: { facing?: number; firstStep?: FirstStep } = {},
): Point {
  if (isClearForArrival(spawn, others, boards)) return spawn;
  const facing = options.facing ?? 0;
  const firstStep = options.firstStep ?? "forward";
  // Forward is angle PI + facing (x = sin, z = cos); your right is a quarter turn less.
  const first = firstStep === "beside" ? Math.PI / 2 + facing : Math.PI + facing;
  for (let ring = 1; ring <= RINGS; ring += 1) {
    for (const turn of ORDER[firstStep]) {
      const angle = first + (turn / PER_RING) * Math.PI * 2;
      const candidate = { x: spawn.x + Math.sin(angle) * RING_STEP * ring, z: spawn.z + Math.cos(angle) * RING_STEP * ring };
      if (isClearForArrival(candidate, others, boards)) return candidate;
    }
  }
  // Nowhere clear: stay at the door rather than be thrown across the room.
  return spawn;
}

/** A board of the given width centred at `at`, turned `rotationY`, as its floor footprint. */
export function boardFootprint(at: Point, width: number, rotationY: number): Segment {
  const dx = (Math.cos(rotationY) * width) / 2;
  const dz = (-Math.sin(rotationY) * width) / 2;
  return { ax: at.x - dx, az: at.z - dz, bx: at.x + dx, bz: at.z + dz };
}
