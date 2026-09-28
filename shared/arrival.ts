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

/** The spot to appear at: `spawn` if it is clear, else the nearest clear spot around it, else `spawn`. */
export function arrivalSpot(spawn: Point, others: readonly Point[], boards: readonly Segment[] = []): Point {
  if (isClearForArrival(spawn, others, boards)) return spawn;
  for (let ring = 1; ring <= RINGS; ring += 1) {
    for (let step = 0; step < PER_RING; step += 1) {
      // Nearest first within a ring, starting toward the room (-z) and
      // alternating sides, so a crowd at the door spreads out evenly.
      const turn = (step % 2 === 0 ? 1 : -1) * Math.ceil(step / 2);
      const angle = Math.PI + (turn / PER_RING) * Math.PI * 2;
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
