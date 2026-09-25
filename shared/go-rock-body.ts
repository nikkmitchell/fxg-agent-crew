import { GO_SURFACE, goBoardWidth } from "./go-layout.js";
import { goRockHoles, goRockOutline, type GoRockHole, type Point2 } from "./go-rock.js";

/**
 * THE SCHOLAR'S STONE BODY (Baiwei, third pass, 2026-09-25): "it's like a
 * scholar stone. It's not only on the top, but the rest of it is ... filled
 * with holes ... turn it to a low poly".
 *
 * So the rock is no longer a slab with a lip: it is a standing stone, from the
 * floor to the playing top, pinched at the waist like a Taihu rock and worn
 * right through by tunnels and hollows all the way down. Only its top is kept
 * flat, as the board.
 *
 * Built as a signed distance field (negative inside the stone) and meshed on
 * a COARSE grid by surface nets, which is what makes it low-poly: every facet
 * is a few centimetres across.
 *
 * Kept where the rest of the table can rely on it:
 * - never above GO_ROCK_BODY_TOP, so the flat top slab (RockForm) sits on it;
 * - never outside the top's own outline, so the bowls and capture rings stay
 *   clear (go-rock.test), and the top is one stone with the body, not a
 *   table top resting on it;
 * - the top's rim holes (goRockHoles) carry on down into the body, and come
 *   out of its side or into a tunnel: perforations, never a blind pit;
 * - pure and seeded by the board's size: everyone sees the same stone.
 */

/** The flat top slab's thickness: the body stops this far under GO_SURFACE. */
export const GO_ROCK_SLAB = 0.02;
export const GO_ROCK_BODY_TOP = GO_SURFACE - GO_ROCK_SLAB;
/**
 * The size of one facet, roughly: larger is lower-poly. It grows with the
 * board, so a 19x19 stone has about as many faces as a 9x9 one and stays
 * cheap in a headset.
 */
export const goRockCell = (size: number) => Math.max(0.035, goBoardWidth(size) / 20);

const hash = (n: number, seed: number) => {
  let h = (n * 374761393 + seed * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};

/** Smooth 3D value noise, 0..1. */
function noise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - x0), fy = s(y - y0), fz = s(z - z0);
  const at = (i: number, j: number, k: number) => hash(((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) >>> 0, seed);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (k: number) => lerp(
    lerp(at(x0, y0, k), at(x0 + 1, y0, k), fx),
    lerp(at(x0, y0 + 1, k), at(x0 + 1, y0 + 1, k), fx), fy);
  return lerp(plane(z0), plane(z0 + 1), fz);
}

/** How far inside a polygon a point is (negative outside). */
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

type Vec = [number, number, number];
export type GoRockTunnel = { from: Vec; to: Vec; radius: number };

/**
 * The stone's tunnels: long capsules that run right through it, mostly
 * across but tilted, spread up its height. They stop short of the slab so
 * the top is always carried. A few are short, blind hollows.
 */
export function goRockTunnels(size: number, foot: number): GoRockTunnel[] {
  const half = goBoardWidth(size) / 2, height = GO_ROCK_BODY_TOP - foot;
  const count = Math.max(8, Math.round(6 + (height / 0.12) * 1.6));
  return Array.from({ length: count }, (_, i) => {
    const r = (k: number) => hash(i * 17 + k, size * 31 + 5);
    const y = foot + height * (0.1 + 0.72 * ((i + r(0) * 0.8) / count));
    const across = r(1) * Math.PI, tilt = (r(2) - 0.5) * 0.9;
    const through = r(3) < 0.7, length = through ? half * 3 : half * (0.5 + r(4) * 0.4);
    const cx = (r(5) - 0.5) * half * 0.9, cz = (r(6) - 0.5) * half * 0.9;
    const dx = Math.cos(across) * Math.cos(tilt), dy = Math.sin(tilt), dz = Math.sin(across) * Math.cos(tilt);
    const radius = Math.min(half * 0.3, height * 0.1 + 0.025) * (0.55 + r(7) * 0.7);
    const top = GO_ROCK_BODY_TOP - radius - 0.03;
    const clamp = (v: number) => Math.min(top, Math.max(foot + radius * 0.5, v));
    return {
      from: [cx - dx * length / 2, clamp(y - dy * length / 2), cz - dz * length / 2],
      to: [cx + dx * length / 2, clamp(y + dy * length / 2), cz + dz * length / 2],
      radius,
    };
  });
}

function capsule(p: Vec, t: GoRockTunnel): number {
  const [ax, ay, az] = t.from, [bx, by, bz] = t.to;
  const px = p[0] - ax, py = p[1] - ay, pz = p[2] - az, dx = bx - ax, dy = by - ay, dz = bz - az;
  const f = Math.max(0, Math.min(1, (px * dx + py * dy + pz * dz) / (dx * dx + dy * dy + dz * dz)));
  return Math.hypot(px - dx * f, py - dy * f, pz - dz * f) - t.radius;
}

/** Distance outside a hole's ellipse on the deck plane (negative inside). */
function holeDistance(x: number, z: number, hole: GoRockHole): number {
  const c = Math.cos(hole.angle), s = Math.sin(hole.angle);
  const dx = x - hole.centre.x, dz = z - hole.centre.z;
  const u = (dx * c + dz * s) / hole.radiusX, v = (-dx * s + dz * c) / hole.radiusZ;
  return (Math.hypot(u, v) - 1) * Math.min(hole.radiusX, hole.radiusZ);
}

/** How deep the rim holes run down into the body before they open out. */
export const GO_ROCK_HOLE_DEPTH = 0.22;

/**
 * The stone's field: negative inside. `foot` is where it stands (the floor,
 * table-local y 0).
 */
export function goRockField(size: number, foot = 0): (p: Vec) => number {
  const half = goBoardWidth(size) / 2, height = GO_ROCK_BODY_TOP - foot;
  const outline = goRockOutline(size), holes = goRockHoles(size);
  const tunnels = goRockTunnels(size, foot);
  const seed = size * 11 + 3;
  return ([x, y, z]) => {
    const h = (y - foot) / height;
    // Wide under the top, pinched at the waist, a little wider at the foot.
    const waist = 0.62 + 0.08 * Math.sin(h * 5.1 + size);
    const profile = h > 0.86 ? 1 : h < 0.12 ? 0.68 + (0.12 - h) * 1.2 : waist + (1 - waist) * Math.max(0, (h - 0.5) / 0.36) ** 2;
    // The waist wanders sideways as it rises, so the stone leans and twists.
    const sway = h < 0.82 ? (1 - h / 0.82) : 0;
    const ox = (noise3(0.5, h * 2.2, 0.5, seed) - 0.5) * half * 0.5 * sway;
    const oz = (noise3(4.5, h * 2.2, 2.5, seed) - 0.5) * half * 0.5 * sway;
    const qx = x - ox, qz = z - oz;
    const radius = (half + 0.2) * profile;
    let d = Math.pow(qx ** 4 + qz ** 4, 0.25) - radius;
    // Weathered: big soft lumps, then smaller ones.
    const n = (noise3(x * 7, y * 7, z * 7, seed) - 0.5) * 0.09 + (noise3(x * 18, y * 18, z * 18, seed + 1) - 0.5) * 0.03;
    d += n * (h > 0.9 ? 0.3 : 1);
    for (const tunnel of tunnels) d = Math.max(d, -capsule([x, y, z], tunnel));
    // The rim holes, carried on down and widening a little as they go.
    const below = GO_ROCK_BODY_TOP - y;
    if (below < GO_ROCK_HOLE_DEPTH) for (const hole of holes) d = Math.max(d, -(holeDistance(x, z, hole) - below * 0.15));
    // Kept inside the top's outline, under the slab, and on the floor.
    d = Math.max(d, -(insideBy({ x, z }, outline) - 0.002), y - GO_ROCK_BODY_TOP, foot - y);
    return d;
  };
}

/**
 * The stone as triangles, by surface nets on a coarse grid. Returns a flat
 * list of positions, three per corner, three corners per face, ready for a
 * non-indexed BufferGeometry: faceted, as low-poly is.
 */
export function goRockBody(size: number, foot = 0, cell = goRockCell(size)): number[] {
  const field = goRockField(size, foot);
  const half = goBoardWidth(size) / 2 + 0.2;
  // A grid that has a plane exactly at the body's top, so the top is flat.
  const ny = Math.max(4, Math.ceil((GO_ROCK_BODY_TOP - foot) / cell));
  const dy = (GO_ROCK_BODY_TOP - foot) / ny;
  const y0 = foot - dy, nyAll = ny + 3;
  const n = Math.ceil((half * 2) / cell), dx = (half * 2) / n, x0 = -half;
  const nx = n + 1;
  const index = (i: number, j: number, k: number) => (j * nx + k) * nx + i;
  const values = new Float64Array(nx * nx * nyAll);
  for (let j = 0; j < nyAll; j++) for (let k = 0; k < nx; k++) for (let i = 0; i < nx; i++) {
    // Nudged off zero, so a corner never sits exactly on the surface.
    const v = field([x0 + i * dx, y0 + j * dy, x0 + k * dx]);
    values[index(i, j, k)] = v === 0 ? 1e-9 : v;
  }
  const at = (i: number, j: number, k: number) =>
    i < 0 || j < 0 || k < 0 || i >= nx || j >= nyAll || k >= nx ? 1 : values[index(i, j, k)];
  const pos = (i: number, j: number, k: number): Vec => [x0 + i * dx, y0 + j * dy, x0 + k * dx];

  // One vertex per cell the surface crosses: the mean of its edge crossings.
  const vertex = new Map<number, Vec>();
  const corners: [number, number, number][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cellVertex = (i: number, j: number, k: number): Vec | undefined => {
    const key = index(i, j, k);
    if (vertex.has(key)) return vertex.get(key);
    const v = corners.map(([a, b, c]) => at(i + a, j + b, k + c));
    let sx = 0, sy = 0, sz = 0, count = 0;
    for (const [a, b] of edges) {
      if ((v[a] < 0) === (v[b] < 0)) continue;
      const t = v[a] / (v[a] - v[b]);
      const pa = pos(i + corners[a][0], j + corners[a][1], k + corners[a][2]);
      const pb = pos(i + corners[b][0], j + corners[b][1], k + corners[b][2]);
      sx += pa[0] + (pb[0] - pa[0]) * t; sy += pa[1] + (pb[1] - pa[1]) * t; sz += pa[2] + (pb[2] - pa[2]) * t;
      count++;
    }
    const out: Vec | undefined = count ? [sx / count, sy / count, sz / count] : undefined;
    if (out) vertex.set(key, out);
    return out;
  };

  const tris: number[] = [];
  const quad = (a?: Vec, b?: Vec, c?: Vec, d?: Vec, flip = false) => {
    if (!a || !b || !c || !d) return;
    const face = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const p of face) tris.push(p[0], p[1], p[2]);
  };
  // Each grid edge that crosses the surface makes one quad from the four
  // cells round it, wound so it faces out of the stone.
  for (let j = 0; j < nyAll; j++) for (let k = 0; k < nx; k++) for (let i = 0; i < nx; i++) {
    const here = at(i, j, k) < 0;
    if (i + 1 < nx && here !== (at(i + 1, j, k) < 0) && j > 0 && k > 0)
      quad(cellVertex(i, j - 1, k - 1), cellVertex(i, j, k - 1), cellVertex(i, j, k), cellVertex(i, j - 1, k), !here);
    if (j + 1 < nyAll && here !== (at(i, j + 1, k) < 0) && i > 0 && k > 0)
      quad(cellVertex(i - 1, j, k - 1), cellVertex(i, j, k - 1), cellVertex(i, j, k), cellVertex(i - 1, j, k), here);
    if (k + 1 < nx && here !== (at(i, j, k + 1) < 0) && i > 0 && j > 0)
      quad(cellVertex(i - 1, j - 1, k), cellVertex(i, j - 1, k), cellVertex(i, j, k), cellVertex(i - 1, j, k), !here);
  }
  return tris;
}
