import { GO_RIM_REACH, goBoardWidth } from "./go-layout.js";

/**
 * The SCHOLAR'S ROCK table's slab: its outline and the holes worn through it.
 * Card saha-ing-82be26cf (Lumenfold, for Baiwei and Nikk): "a dark,
 * asymmetrical natural scholar's rock (gongshi) ... a few irregular
 * through-holes/voids. Keep the actual playable grid plane flat, level, and
 * fully clear; put holes and strongest silhouette variation around the
 * perimeter so no playable intersections are lost."
 *
 * So the slab is the board's rim grown into a stone: the playing surface sits
 * on it unchanged, and everything irregular happens in a margin that starts
 * outside the board's own edge and never reaches past GO_ROCK.margin.max —
 * inside the bowls' stations for every board size and player count.
 *
 * Pure and seeded by the board's size, so every person at the table sees the
 * same rock, and a test can check where the holes are (go-rock.test.ts).
 * Coordinates are table-local metres on the deck plane: x across, z along.
 */
export const GO_ROCK = {
  margin: {
    /** The slab always shows at least this much beyond the board's edge. */
    min: 0.03,
    /** And never more: the bowls and capture rings start outside this. */
    max: GO_RIM_REACH,
  },
  /** Points round the outline: low-poly by request. */
  points: 56,
  /** How many holes, at most. */
  holes: 5,
};

export type Point2 = { x: number; z: number };
export type GoRockHole = { centre: Point2; radiusX: number; radiusZ: number; angle: number };

const hash = (n: number, seed: number) => {
  let h = (n * 374761393 + seed * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};

/** Smooth periodic noise round the outline, 0..1, from a few seeded harmonics. */
function weathering(t: number, seed: number): number {
  let sum = 0, weight = 0;
  for (let k = 1; k <= 5; k++) {
    const amplitude = 1 / k;
    sum += Math.sin(2 * Math.PI * (k * t + hash(k, seed))) * amplitude;
    weight += amplitude;
  }
  return 0.5 + 0.5 * (sum / weight);
}

/** How far the slab reaches past the board's edge at `t` round the outline (0..1). */
function marginAt(t: number, size: number): number {
  const { min, max } = GO_ROCK.margin;
  return min + (max - min) * weathering(t, size * 7 + 3);
}

/** A point on the square of half-width `half`, `t` of the way round it (0..1). */
function onSquare(t: number, half: number): Point2 & { normal: Point2 } {
  const along = ((t % 1) + 1) % 1 * 4, side = Math.floor(along), f = along - side;
  const s = -half + 2 * half * f;
  if (side === 0) return { x: s, z: -half, normal: { x: 0, z: -1 } };
  if (side === 1) return { x: half, z: s, normal: { x: 1, z: 0 } };
  if (side === 2) return { x: -s, z: half, normal: { x: 0, z: 1 } };
  return { x: -half, z: -s, normal: { x: -1, z: 0 } };
}

/** The slab's outline, anticlockwise, table-local. */
export function goRockOutline(size: number): Point2[] {
  const half = goBoardWidth(size) / 2;
  return Array.from({ length: GO_ROCK.points }, (_, i) => {
    const t = i / GO_ROCK.points, p = onSquare(t, half), m = marginAt(t, size);
    return { x: p.x + p.normal.x * m, z: p.z + p.normal.z * m };
  });
}

/**
 * The holes: where the margin is widest, a few irregular ovals worn right
 * through, spaced round the rock rather than bunched. Each keeps clear of the
 * board's edge and of the rock's own edge, so it is a hole, not a notch.
 */
export function goRockHoles(size: number): GoRockHole[] {
  const half = goBoardWidth(size) / 2, samples = 240;
  const wide = Array.from({ length: samples }, (_, i) => ({ t: i / samples, m: marginAt(i / samples, size) }))
    .sort((a, b) => b.m - a.m);
  const chosen: { t: number; m: number }[] = [];
  for (const candidate of wide) {
    if (chosen.length >= GO_ROCK.holes || candidate.m < 0.055) break;
    const apart = chosen.every((c) => Math.min(Math.abs(c.t - candidate.t), 1 - Math.abs(c.t - candidate.t)) > 0.075);
    if (apart) chosen.push(candidate);
  }
  const outline = goRockOutline(size);
  const holes: GoRockHole[] = [];
  chosen.forEach(({ t }, i) => {
    const p = onSquare(t, half), stretch = 1.4 + hash(i, size) * 0.8;
    const angle = (hash(i + 11, size) - 0.5) * 0.3;
    // Tried large first and shrunk until the hole has stone all round it and
    // stays off the board: checked against the actual outline, because the
    // outline wanders and turns corners, and a hole sized by its middle alone
    // can run out of stone at its ends and become a notch.
    for (let across = 0.022; across >= 0.012; across -= 0.001) {
      const depth = Math.max(0.012 + across, 0.009 + (marginAt(t, size) - 0.018) / 2);
      const hole = {
        centre: { x: p.x + p.normal.x * depth, z: p.z + p.normal.z * depth },
        radiusX: p.normal.x !== 0 ? across : across * stretch,
        radiusZ: p.normal.z !== 0 ? across : across * stretch,
        angle,
      };
      if (holeFits(hole, half, outline)) { holes.push(hole); return; }
    }
  });
  return holes;
}

/** Points round a hole's edge. */
function holeRim(hole: GoRockHole, points = 32): Point2[] {
  const c = Math.cos(hole.angle), s = Math.sin(hole.angle);
  return Array.from({ length: points }, (_, k) => {
    const a = (k / points) * Math.PI * 2, x = Math.cos(a) * hole.radiusX, z = Math.sin(a) * hole.radiusZ;
    return { x: hole.centre.x + x * c - z * s, z: hole.centre.z + x * s + z * c };
  });
}

/** Off the board by 8 mm, and 8 mm of stone between it and the rock's edge. */
function holeFits(hole: GoRockHole, half: number, outline: Point2[]): boolean {
  return holeRim(hole).every((q) =>
    Math.max(Math.abs(q.x), Math.abs(q.z)) - half > 0.008 && insideBy(q, outline) > 0.008);
}

/** How far inside the polygon a point is (negative if outside). */
function insideBy(q: Point2, polygon: Point2[]): number {
  let hit = false, best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if ((b.z > q.z) !== (a.z > q.z) && q.x < ((a.x - b.x) * (q.z - b.z)) / (a.z - b.z) + b.x) hit = !hit;
    const dx = b.x - a.x, dz = b.z - a.z;
    const f = Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(q.x - (a.x + f * dx), q.z - (a.z + f * dz)));
  }
  return hit ? best : -best;
}

/**
 * THE ROCK AS ONE FORM (Baiwei's second pass, via Lumenfold): "one monolithic
 * irregular gongshi form, directly carved lines on its flat top, no separate
 * board/slab, expressive side perforations/undercuts outside playable
 * intersections, calmer facets".
 *
 * So the rock is a LOFT: a stack of outlines from the deck up to the playing
 * height, joined into one body. The top ring is the outline above, at exactly
 * GO_SURFACE, and the whole top is one flat face: the board is not a separate
 * thing laid on it, it is the rock's own top with the grid cut into it.
 *
 * Below the top the rock draws in — an overhanging lip, as a Taihu rock
 * overhangs its base — to a waist that is never outside the board's own edge.
 * The holes go down through the lip only, and open into the air under the
 * overhang: perforations and undercuts from one move, and none of it under a
 * playable point.
 *
 * Each ring: `height` 0..1 from the deck (0) to the top (1), and its points,
 * table-local on the deck plane, in step with goRockOutline's.
 */
export type GoRockRing = { height: number; points: Point2[] };

/** How far down the lip goes, as a share of the rock's height. The holes stop here. */
export const GO_ROCK_LIP = 0.42;

export function goRockRings(size: number): GoRockRing[] {
  const half = goBoardWidth(size) / 2;
  const top = goRockOutline(size);
  // A point `inset` in from the board's edge along the outline's own normal,
  // wandering a little so the waist is not a box.
  const toward = (i: number, reachPastEdge: number) => {
    const t = i / GO_ROCK.points, p = onSquare(t, half);
    return { x: p.x + p.normal.x * reachPastEdge, z: p.z + p.normal.z * reachPastEdge };
  };
  const wander = (i: number, seed: number, amount: number) =>
    (weathering(i / GO_ROCK.points, size * 13 + seed) - 0.5) * amount;
  return [
    // The foot: a little inside the board's edge, uneven.
    { height: 0, points: top.map((_, i) => toward(i, -0.035 + wander(i, 1, 0.03))) },
    // The waist, where the hollow under the lip is deepest.
    { height: 0.3, points: top.map((_, i) => toward(i, -0.05 + wander(i, 2, 0.04))) },
    // The lip's underside: the holes open here, so it stays inside every hole.
    { height: 1 - GO_ROCK_LIP, points: top.map((_, i) => toward(i, -0.01 + wander(i, 3, 0.012))) },
    // Just under the top edge, a soft roll rather than a sawn corner.
    { height: 0.93, points: top.map((p) => ({ x: p.x * 0.995, z: p.z * 0.995 })) },
    // The top: the outline itself, at the playing height.
    { height: 1, points: top },
  ];
}
