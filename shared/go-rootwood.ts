import { goBoardWidth } from "./go-layout.js";
import { meshField, noise3, roundCone, smoothUnion, type Vec } from "./sdf-mesh.js";

/**
 * THE ROOTWOOD THRONE, a fourth Go table (saha-ing-c1fd1ba9, Baiwei): "an
 * expressive inverted tree-trunk / rootwood sculpture inspired by Chinese
 * root-wood tables and thrones: sculptural root flare around the top, trunk
 * tapering down to a stable base, asymmetrical and artful rather than a
 * generic stump ... flat, level, legible Go grid ... low-poly natural
 * character without distracting grain".
 *
 * So the table is a tree turned over. Its roots spread up and out under the
 * top and hold it at the edges; they gather into a trunk that narrows to a
 * waist and flares again to a few short feet on the floor. The top itself is
 * the table's ordinary flat wooden board, so the grid, the stones and every
 * control are exactly as on bamboo: only what holds it up is new.
 *
 * Kept where the rest of the table can rely on it:
 * - never above ROOTWOOD_TOP, the underside of the flat top;
 * - never outside the top's own square, so the bowls and capture rings, which
 *   sit outside it on every table, stay clear;
 * - pure and seeded by the board's size: everyone sees the same wood.
 *
 * Table-local metres: x across, z along, y up from the floor.
 */

/** The underside of the flat top (the rim box is 0.105 m tall, centred at 0.79). */
export const ROOTWOOD_TOP = 0.79 - 0.105 / 2;
/** The top's half-width: the board plus the 3 cm rim every table has. */
export const rootwoodHalf = (size: number) => (goBoardWidth(size) + 0.06) / 2;
/** About how big a facet is: grows with the board, so every size costs about the same. */
export const rootwoodCell = (size: number) => Math.max(0.03, rootwoodHalf(size) / 11);

const hash = (n: number, seed: number) => {
  let h = (n * 374761393 + seed * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
};

type Limb = { a: Vec; b: Vec; ra: number; rb: number };

/** Where the roots and feet run: pure, for tests and for the field. */
export function rootwoodLimbs(size: number): { trunk: Limb[]; roots: Limb[]; feet: Limb[] } {
  const half = rootwoodHalf(size), top = ROOTWOOD_TOP, seed = size * 17 + 5;
  const r = (k: number) => hash(k, seed);
  // A slight lean, so it is a piece of wood and not a turned column.
  const lean: Vec = [(r(1) - 0.5) * half * 0.18, 0, (r(2) - 0.5) * half * 0.18];
  const at = (h: number, x = 0, z = 0): Vec => [x + lean[0] * h, h * top, z + lean[2] * h];
  const base = 0.05 + half * 0.2, waist = 0.045 + half * 0.1, crown = 0.05 + half * 0.16;
  const trunk: Limb[] = [
    { a: at(0.05), b: at(0.42), ra: base, rb: waist },
    { a: at(0.42), b: at(0.8), ra: waist, rb: crown },
  ];

  // THE ROOTS, spread round the top and out to its edge, rising as they go.
  const count = 7 + (size >= 13 ? 2 : 0);
  const roots: Limb[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ((i + (r(10 + i) - 0.5) * 0.5) / count) * Math.PI * 2;
    const c = Math.cos(angle), s = Math.sin(angle);
    // Out to near the square's edge in this direction, corners included.
    const edge = (half * 0.9) / Math.max(Math.abs(c), Math.abs(s));
    const start = at(0.74, c * crown * 0.5, s * crown * 0.5);
    const bend: Vec = [c * edge * 0.55 + lean[0], top * (0.87 + r(30 + i) * 0.05), s * edge * 0.55 + lean[2]];
    // Into the top, not just under it: the flat cut at ROOTWOOD_TOP then makes
    // a clean joint, where stopping short left the top floating on a gap.
    const end: Vec = [c * edge, top + 0.01, s * edge];
    const thick = 0.03 + half * 0.07 * (0.75 + r(50 + i) * 0.5);
    roots.push({ a: start, b: bend, ra: thick, rb: thick * 0.72 });
    roots.push({ a: bend, b: end, ra: thick * 0.72, rb: thick * 0.42 });
  }

  // THE FEET: a few short roots on the floor, so it stands.
  const feet: Limb[] = [];
  for (let i = 0; i < 5; i++) {
    const angle = ((i + r(70 + i) * 0.6) / 5) * Math.PI * 2;
    const reach = half * (0.42 + r(80 + i) * 0.14);
    feet.push({
      a: at(0.16),
      b: [Math.cos(angle) * reach, 0.03, Math.sin(angle) * reach],
      ra: base * 0.55,
      rb: 0.035,
    });
  }
  return { trunk, roots, feet };
}

/** The wood as a field: negative inside. */
export function rootwoodField(size: number): (p: Vec) => number {
  const half = rootwoodHalf(size), top = ROOTWOOD_TOP, seed = size * 29 + 11;
  const { trunk, roots, feet } = rootwoodLimbs(size);
  const limbs = [...trunk, ...roots, ...feet];
  return (p) => {
    let d = Infinity;
    for (const limb of limbs) d = smoothUnion(d === Infinity ? 1 : d, roundCone(p, limb.a, limb.b, limb.ra, limb.rb), 0.07);
    // Bark: slow, broad lumps, never a busy grain.
    d += (noise3(p[0] * 9, p[1] * 5, p[2] * 9, seed) - 0.5) * 0.02;
    // Under the top, on the floor, and inside the top's square.
    return Math.max(d, p[1] - top, -p[1], Math.max(Math.abs(p[0]), Math.abs(p[2])) - (half - 0.004));
  };
}

/** The wood as faceted triangles (see meshField). */
export function rootwoodMesh(size: number): number[] {
  const half = rootwoodHalf(size);
  return meshField(
    rootwoodField(size),
    { minX: -half, maxX: half, minY: 0, maxY: ROOTWOOD_TOP, minZ: -half, maxZ: half },
    rootwoodCell(size),
  );
}
