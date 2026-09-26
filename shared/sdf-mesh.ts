/**
 * A SHAPE FROM A DISTANCE FIELD, AS LOW-POLY TRIANGLES.
 *
 * `field` is negative inside the shape and positive outside. It is sampled on a
 * grid of `cell`-sized cubes, and surface nets puts one vertex in each cube the
 * surface passes through (the average of where it crosses the cube's edges) and
 * joins them into quads. A coarse grid is what makes the result faceted: every
 * face is about a cell across, which is the low-poly look the room's sculpted
 * pieces ask for, and a few thousand faces, which a headset draws easily.
 *
 * The grid has a plane exactly at `box.maxY`, so a field cut flat there comes
 * out with a flat top. Pure: the same field always gives the same triangles.
 *
 * Returned as a flat list of positions, three numbers a corner and three
 * corners a face, for a non-indexed BufferGeometry: each face then gets its
 * own normal, which is the faceting.
 */
export type Vec = [number, number, number];
export type Box = { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };

export function meshField(field: (p: Vec) => number, box: Box, cell: number): number[] {
  const ny = Math.max(4, Math.ceil((box.maxY - box.minY) / cell));
  const dy = (box.maxY - box.minY) / ny;
  // One layer of margin below and two above, so nothing touches the grid's edge.
  const y0 = box.minY - dy, nyAll = ny + 3;
  const nxCells = Math.max(2, Math.ceil((box.maxX - box.minX) / cell));
  const nzCells = Math.max(2, Math.ceil((box.maxZ - box.minZ) / cell));
  const dx = (box.maxX - box.minX) / nxCells, dz = (box.maxZ - box.minZ) / nzCells;
  const x0 = box.minX - dx, z0 = box.minZ - dz;
  const nx = nxCells + 3, nz = nzCells + 3;
  const index = (i: number, j: number, k: number) => (j * nz + k) * nx + i;

  const values = new Float64Array(nx * nz * nyAll);
  for (let j = 0; j < nyAll; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    // Nudged off zero, so a corner never sits exactly on the surface.
    const v = field([x0 + i * dx, y0 + j * dy, z0 + k * dz]);
    values[index(i, j, k)] = v === 0 ? 1e-9 : v;
  }
  const at = (i: number, j: number, k: number) =>
    i < 0 || j < 0 || k < 0 || i >= nx || j >= nyAll || k >= nz ? 1 : values[index(i, j, k)];
  const pos = (i: number, j: number, k: number): Vec => [x0 + i * dx, y0 + j * dy, z0 + k * dz];

  const vertex = new Map<number, Vec | null>();
  const corners: Vec[] = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const cellVertex = (i: number, j: number, k: number): Vec | null => {
    const key = index(i, j, k);
    const known = vertex.get(key);
    if (known !== undefined) return known;
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
    const out: Vec | null = count ? [sx / count, sy / count, sz / count] : null;
    vertex.set(key, out);
    return out;
  };

  const tris: number[] = [];
  const quad = (a: Vec | null, b: Vec | null, c: Vec | null, d: Vec | null, flip: boolean) => {
    if (!a || !b || !c || !d) return;
    const face = flip ? [a, c, b, a, d, c] : [a, b, c, a, c, d];
    for (const p of face) tris.push(p[0], p[1], p[2]);
  };
  // Each grid edge the surface crosses makes one quad from the four cells
  // round it, wound so it faces out of the shape.
  for (let j = 0; j < nyAll; j++) for (let k = 0; k < nz; k++) for (let i = 0; i < nx; i++) {
    const here = at(i, j, k) < 0;
    if (i + 1 < nx && here !== (at(i + 1, j, k) < 0) && j > 0 && k > 0)
      quad(cellVertex(i, j - 1, k - 1), cellVertex(i, j, k - 1), cellVertex(i, j, k), cellVertex(i, j - 1, k), !here);
    if (j + 1 < nyAll && here !== (at(i, j + 1, k) < 0) && i > 0 && k > 0)
      quad(cellVertex(i - 1, j, k - 1), cellVertex(i, j, k - 1), cellVertex(i, j, k), cellVertex(i - 1, j, k), here);
    if (k + 1 < nz && here !== (at(i, j, k + 1) < 0) && i > 0 && j > 0)
      quad(cellVertex(i - 1, j - 1, k), cellVertex(i, j - 1, k), cellVertex(i, j, k), cellVertex(i - 1, j, k), !here);
  }
  return tris;
}

/** Distance from `p` to a round cone from `a` (radius ra) to `b` (radius rb); negative inside. */
export function roundCone(p: Vec, a: Vec, b: Vec, ra: number, rb: number): number {
  const bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const pax = p[0] - a[0], pay = p[1] - a[1], paz = p[2] - a[2];
  const lengthSq = bax * bax + bay * bay + baz * baz || 1e-12;
  const t = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / lengthSq));
  const dx = pax - bax * t, dy = pay - bay * t, dz = paz - baz * t;
  return Math.hypot(dx, dy, dz) - (ra + (rb - ra) * t);
}

/** A smooth union of two distances: organic joins rather than a crease. */
export function smoothUnion(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
}

/** Smooth 3D value noise, 0..1, the same for every device. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const hash = (n: number) => {
    let h = (n * 374761393 + seed * 668265263) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 2 ** 32;
  };
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const s = (t: number) => t * t * (3 - 2 * t);
  const fx = s(x - x0), fy = s(y - y0), fz = s(z - z0);
  const at = (i: number, j: number, k: number) => hash(((i * 73856093) ^ (j * 19349663) ^ (k * 83492791)) >>> 0);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const plane = (k: number) => lerp(lerp(at(x0, y0, k), at(x0 + 1, y0, k), fx), lerp(at(x0, y0 + 1, k), at(x0 + 1, y0 + 1, k), fx), fy);
  return lerp(plane(z0), plane(z0 + 1), fz);
}
