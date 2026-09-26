import type { GoRoomItem } from "./room-items.js";
export type Point3 = { x: number; y: number; z: number };
/** Constant pitch and stone diameter. More intersections make a larger board,
 * never a denser grid; item.scale is the separate whole-table resize control. */
export const GO_PITCH = 0.075;
export const goExtent = (size: number) => (size - 1) * GO_PITCH;
export const goBoardWidth = (size: number) => goExtent(size) + 0.2;
export function goDeckWidth(size: number, colours: number, rim = GO_RIM_REACH): number {
  let halfWidth = Math.max(1.7, goBoardWidth(size) + (colours > 2 ? 1.4 : 1.12)) / 2;
  // Wide enough for every capture ring, whole, with a margin.
  const edge = goRingStone(size) + 0.04;
  for (let i = 0; i < colours; i++) {
    for (let n = 0; n < goRingSlots(i, colours, size, rim); n++) {
      const spot = goRingSpot(i, colours, size, n, rim);
      halfWidth = Math.max(halfWidth, Math.abs(spot.x) + edge, Math.abs(spot.z) + edge);
    }
  }
  return halfWidth * 2;
}
export const GO_SURFACE = 0.86;
/**
 * How far past the board's own edge the rim may reach. The plain rim reaches
 * 0.03; the scholar's rock grows into this whole margin (shared/go-rock.ts).
 * Everything round the board — bowls, capture rings — keeps outside it.
 */
export const GO_RIM_REACH = 0.09;
/**
 * The SCHOLAR'S ROCK reaches further: its lip is the rock, and at 19x19 a
 * 9 cm lip read as a slate board, not a rock. The sculpted form needs up to
 * 28 cm for its lobes, grottoes and rounded shoulders. Only the rock's stations move;
 * bamboo and stone keep every position, seat and reach they had.
 */
export const GO_ROCK_REACH = 0.28;
/** How far the rim reaches for a board surface. */
export const goRimReach = (surface?: string) => (surface === "rock" ? GO_ROCK_REACH : GO_RIM_REACH);
export const goPoint = (n: number, size: number) => -goExtent(size) / 2 + n * GO_PITCH;
export const goRadius = (_size?: number) => GO_PITCH * 0.43;
export function goBowl(index: number, count: number, size = 9, rim = GO_RIM_REACH): Point3 {
  const angle = Math.PI + index / count * Math.PI * 2;
  // A square perimeter keeps diagonal bowls outside the square playing surface.
  // Small boards still need enough perimeter for eight bowl-and-tray stations.
  // A rim that reaches further moves every station out by the same amount.
  const stationEdge = Math.max(goBoardWidth(size) / 2 + 0.295 + (rim - GO_RIM_REACH), count >= 6 ? 0.76 + (rim - GO_RIM_REACH) : 0);
  const radius = stationEdge / Math.max(Math.abs(Math.cos(angle)), Math.abs(Math.sin(angle)));
  return { x: Math.cos(angle) * radius, y: GO_SURFACE - 0.06, z: Math.sin(angle) * radius };
}
export function goLocal(p: Point3, item: GoRoomItem): Point3 {
  const x = (p.x - item.position.x) / item.scale;
  const z = (p.z - item.position.z) / item.scale;
  const c = Math.cos(item.position.rotationY), s = Math.sin(item.position.rotationY);
  return { x: c * x - s * z, y: (p.y - item.position.y) / item.scale, z: s * x + c * z };
}
export function goWorld(p: Point3, item: GoRoomItem): Point3 {
  const c = Math.cos(item.position.rotationY), s = Math.sin(item.position.rotationY);
  return { x: item.position.x + (c * p.x + s * p.z) * item.scale,
    y: item.position.y + p.y * item.scale, z: item.position.z + (-s * p.x + c * p.z) * item.scale };
}
export function goTouchBowl(p: Point3, item: GoRoomItem): boolean {
  const b = goBowl(item.activeColour, item.colours.length, item.size, goRimReach(item.surface));
  return Math.hypot(p.x - b.x, p.z - b.z) < 0.19 && p.y > b.y - 0.06 && p.y < b.y + 0.15;
}
export function goTouchIntersection(p: Point3, size: number): { x: number; y: number } | null {
  if (p.y < GO_SURFACE - 0.025 || p.y > GO_SURFACE + 0.085) return null;
  const step = GO_PITCH, extent = goExtent(size);
  const x = Math.round((p.x + extent / 2) / step), y = Math.round((p.z + extent / 2) / step);
  if (x < 0 || y < 0 || x >= size || y >= size) return null;
  return Math.hypot(p.x - goPoint(x, size), p.z - goPoint(y, size)) < step * 0.43 ? { x, y } : null;
}

/**
 * Where somebody playing a colour stands: BEHIND THEIR OWN BOWL, just off the
 * edge of the desk, facing the middle of the table. In room coordinates, on the
 * floor, with the same yaw convention as a panel's standing place (an avatar
 * faces -Z, so facing the table from S means atan2(S - centre)).
 *
 * For agents playing through code (tools/go.mts): the room walks them here
 * when they move, so the people in the room see who is playing, and where.
 * Their own bowl rather than the near side, because the near side is where a
 * person stands to read the turn line — an agent arriving there would stand in
 * them. With two players the bowls are left and right of the board, so the
 * two agents face each other across it.
 */
export function goSeat(item: GoRoomItem, colour: number): { at: Point3; facing: number } {
  const bowl = goBowl(colour, item.colours.length, item.size, goRimReach(item.surface));
  const length = Math.hypot(bowl.x, bowl.z) || 1;
  const out = { x: bowl.x / length, z: bowl.z / length };
  // The desk is square, so both the edge and the 0.4 m clearance are measured
  // square to it: a diagonal seat would otherwise stand only 0.28 m off a corner.
  const along = Math.max(Math.abs(out.x), Math.abs(out.z));
  const reach = (goDeckWidth(item.size, item.colours.length, goRimReach(item.surface)) / 2 + 0.4) / along;
  const at = goWorld({ x: out.x * reach, y: 0, z: out.z * reach }, item);
  const centre = goWorld({ x: 0, y: 0, z: 0 }, item);
  return { at: { x: at.x, y: 0, z: at.z }, facing: Math.atan2(at.x - centre.x, at.z - centre.z) };
}

/**
 * How big the bowls are drawn beside a board of this size — in proportion to
 * it. Nikk's request, via Lumenfold: "Scale the bowl models proportionally to
 * the board size/type so they feel right beside the intersections and do not
 * crowd play." A 36cm bowl was drawn beside every board, which beside a 5×5
 * board half a metre across looked like two buckets. Full size at 19×19, the
 * board they were made beside; smaller for smaller boards, never below 65%;
 * never bigger than full for 25×25, where they sit further out anyway.
 */
export function goBowlScale(size: number): number {
  const full = goBoardWidth(19);
  return Math.min(1, Math.max(0.65, 0.55 + 0.45 * (goBoardWidth(size) / full)));
}

/**
 * THE CAPTURE RING: where the stones you have taken are laid out, in place of
 * the separate brown pad that used to sit beside each bowl.
 *
 * Baiwei and Nikk (card saha-ing-aad334f9): "a delicate circular capture ring
 * just outside the stone bowl; captured stones should collect/read cleanly
 * along the ring as captures accumulate". So captures are beads on an ARC
 * round the bowl — first row, then a second row just outside it — turned away
 * from the board and away from the bowl's name and PASS (see GO_RING.reach).
 *
 * In the bowl's scale (goBowlScale), so a small board's smaller bowl gets a
 * smaller ring and the same number of stones still fit.
 */
export const GO_RING = {
  /** Radii of the two rows, bowl-local. The bowl's rim is at 0.18. */
  rows: [0.265, 0.34] as const,
  /** Centre to centre along the arc, bowl-local. A captured stone is ≤0.064 across. */
  spacing: 0.072,
  /** Captured stones sit on the deck, whose top is at 0.7425. */
  y: 0.7425,
  /** The longest arc, either side of its middle, in radians: about 130° in all. */
  reach: 1.125,
  /** Kept between a captured stone and anything else, beyond just not touching. */
  margin: 0.015,
};

/** A captured stone's radius: scaled with its bowl, as the stones in the bowl are. */
export const goRingStone = (size: number) => Math.min(goRadius(), 0.032) * goBowlScale(size);

type RingArc = { centre: Point3; start: number; reach: number; scale: number };
const arcs = new Map<string, RingArc>();

/**
 * Each bowl's ring, fitted to the room it actually has.
 *
 * A fixed arc worked for two and four players and hit something for the rest:
 * with three to seven, a bowl sits at a diagonal and its name and PASS (which
 * stack along z, see goLabelOffset) take one side of it, leaving as little as
 * 81° free. So this looks round the bowl a degree at a time, keeps every angle
 * where BOTH rows would clear the board, every bowl and the name and PASS, and
 * centres the ring in the longest free stretch, up to GO_RING.reach each way.
 * A tighter bowl gets a shorter ring and shows fewer of its newest captures;
 * the count under its name is always the whole number.
 */
function ringArc(index: number, count: number, size: number, rim = GO_RIM_REACH): RingArc {
  const key = `${index}/${count}/${size}/${rim}`;
  const known = arcs.get(key);
  if (known) return known;
  const centre = goBowl(index, count, size, rim), scale = goBowlScale(size), stone = goRingStone(size);
  const board = goBoardWidth(size) / 2 + rim + 0.01;
  const labels = [{ at: 0.24, halfX: 0.2, halfZ: 0.06 }, { at: 0.35, halfX: 0.17, halfZ: 0.05 }]
    .map((box) => ({ ...box, z: centre.z + goLabelOffset(index, count, box.at).z * scale }));
  const others = Array.from({ length: count }, (_, j) => goBowl(j, count, size, rim));
  const clear = (angle: number) => GO_RING.rows.every((row) => {
    const x = centre.x + Math.cos(angle) * row * scale, z = centre.z + Math.sin(angle) * row * scale;
    if (Math.max(Math.abs(x), Math.abs(z)) - stone < board) return false;
    if (others.some((bowl) => Math.hypot(x - bowl.x, z - bowl.z) - stone - 0.18 * scale < GO_RING.margin)) return false;
    return labels.every((box) => Math.hypot(
      Math.max(0, Math.abs(x - centre.x) - box.halfX * scale),
      Math.max(0, Math.abs(z - box.z) - box.halfZ * scale)) > stone + GO_RING.margin);
  });
  const step = Math.PI / 180, free = Array.from({ length: 360 }, (_, k) => clear(k * step));
  let best = { from: 0, length: 0 };
  for (let k = 0; k < 360; k++) {
    if (!free[k] || free[(k + 359) % 360]) continue; // the start of a free run
    let length = 0;
    while (length < 360 && free[(k + length) % 360]) length++;
    if (length > best.length) best = { from: k, length };
  }
  if (free.every(Boolean)) best = { from: 0, length: 360 };
  // One degree in from each end, so a stone at the very end still clears.
  const reach = Math.min(GO_RING.reach, Math.max(0, (best.length - 2) * step / 2));
  const middle = (best.from + best.length / 2) * step;
  const arc = { centre, start: middle - reach, reach, scale };
  arcs.set(key, arc);
  return arc;
}

/** How many stones one row of a bowl's ring holds. */
export function goRingCapacity(index: number, count: number, size: number, row: 0 | 1, rim = GO_RIM_REACH): number {
  const { reach } = ringArc(index, count, size, rim);
  return Math.floor((2 * reach * GO_RING.rows[row]) / GO_RING.spacing) + 1;
}

/** Every stone a bowl's ring can show: both rows. Older captures are counted, not drawn. */
export const goRingSlots = (index: number, count: number, size: number, rim = GO_RIM_REACH) =>
  goRingCapacity(index, count, size, 0, rim) + goRingCapacity(index, count, size, 1, rim);

/** A bowl's ring as an arc, for drawing its line. */
export function goRingArc(index: number, count: number, size: number, row: 0 | 1 = 0, rim = GO_RIM_REACH) {
  const arc = ringArc(index, count, size, rim);
  return { centre: arc.centre, radius: GO_RING.rows[row] * arc.scale, start: arc.start, length: 2 * arc.reach };
}

/** Where the n-th captured stone (0 = the oldest shown) lies on a bowl's ring. */
export function goRingSpot(index: number, count: number, size: number, n: number, rim = GO_RIM_REACH): Point3 {
  const first = goRingCapacity(index, count, size, 0, rim);
  const row: 0 | 1 = n < first ? 0 : 1;
  const k = row === 0 ? n : n - first;
  const arc = goRingArc(index, count, size, row, rim);
  const angle = arc.start + (k * GO_RING.spacing) / GO_RING.rows[row];
  return {
    x: arc.centre.x + Math.cos(angle) * arc.radius,
    y: GO_RING.y + goRingStone(size) * 0.46,
    z: arc.centre.z + Math.sin(angle) * arc.radius,
  };
}

/**
 * Where a bowl's name and PASS go, bowl-local: stacked along z, `distance`
 * from the bowl's centre, on the side the old capture pad did NOT use. Both
 * are wide and flat, so they stack along one axis rather than going round the
 * bowl; the capture ring is shaped to stay clear of them (go-capture-ring.test).
 */
export function goLabelOffset(index: number, count: number, distance: number): { x: number; z: number } {
  const outward = Math.PI + (index / count) * Math.PI * 2;
  return { x: 0, z: Math.cos(outward) * 0.38 > 0 ? -distance : distance };
}
