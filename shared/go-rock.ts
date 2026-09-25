import { GO_ROCK_REACH, GO_RING, GO_SURFACE, goBoardWidth } from "./go-layout.js";

/** One horizontal viewing stone, including the walls of its caves. Distances
 * are table-local metres; the playing plateau remains exactly at GO_SURFACE. */
export const GO_ROCK = { points: 192, holes: 7, margin: { min: 0.035, max: GO_ROCK_REACH } };
export type Point2 = { x: number; z: number };
export type GoRockHole = { centre: Point2; radiusX: number; radiusZ: number; angle: number };
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Broad unequal lobes and smaller folds, identical for every viewer.
function reach(angle: number): number {
  return 0.171 + 0.061 * Math.sin(3 * angle + 0.7) + 0.027 * Math.cos(5 * angle - 0.4)
    + 0.017 * Math.sin(angle + 1.2);
}
const squareRadius = (x: number, z: number) => (Math.abs(x) ** 5 + Math.abs(z) ** 5) ** (1 / 5);

export function goRockOutline(size: number): Point2[] {
  const half = goBoardWidth(size) / 2;
  return Array.from({ length: GO_ROCK.points }, (_, i) => {
    const angle = i * Math.PI * 2 / GO_ROCK.points, c = Math.cos(angle), s = Math.sin(angle);
    const r = (half + reach(angle)) / squareRadius(c, s);
    return { x: r * c, z: r * s };
  });
}

/** Curated spacing and unequal proportions avoid a row of drilled holes. */
export function goRockHoles(size: number): GoRockHole[] {
  const half = goBoardWidth(size) / 2;
  const stations = [[0, -0.52, 0.094], [0, 0.43, 0.071], [1, -0.4, 0.105],
    [1, 0.51, 0.073], [2, -0.38, 0.105], [2, 0.52, 0.082], [3, 0.13, 0.12]];
  return stations.map(([side, along, length]) => {
    const angle = side * Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle);
    const tangent = along * half;
    let low = half, high = half + GO_ROCK_REACH;
    for (let n = 0; n < 16; n++) {
      const normal = (low + high) / 2;
      const x = tangent * c - normal * s, z = tangent * s + normal * c;
      if (squareRadius(x, z) < half + reach(Math.atan2(z, x))) low = normal;
      else high = normal;
    }
    const margin = low - half, normal = half + margin * 0.49;
    return { centre: { x: tangent * c - normal * s, z: tangent * s + normal * c },
      radiusX: length, radiusZ: Math.min(0.05, margin * 0.23), angle };
  });
}

function smoothMax(a: number, b: number, radius: number): number {
  const h = Math.max(radius - Math.abs(a - b), 0) / radius;
  return Math.max(a, b) + h * h * radius * 0.25;
}

export function createGoRockField(size: number) {
  const half = goBoardWidth(size) / 2, bottom = GO_RING.y;
  const holes = goRockHoles(size).map((hole, i) => ({ ...hole,
    c: Math.cos(hole.angle), s: Math.sin(hole.angle), phase: i * 1.71,
  }));
  return (x: number, y: number, z: number): number => {
    const edge = Math.max(Math.abs(x), Math.abs(z)) - half;
    if (edge < -0.095) return Math.max(y - GO_SURFACE, bottom - y);
    const angle = Math.atan2(z, x), radius = squareRadius(x, z), shore = half + reach(angle);
    const h = (y - bottom) / (GO_SURFACE - bottom);
    const fold = Math.sin(x * 31 + Math.sin(z * 19) * 1.4 + y * 17)
      * Math.sin(z * 27 - Math.sin(x * 13) + y * 23);
    const worn = Math.sin(x * 17 + z * 11) * Math.cos(z * 21 - x * 7);
    const shoulder = smoothstep(-0.05 + 0.02 * Math.sin(angle * 2), 0.10 + 0.025 * Math.sin(angle * 3), edge);
    const undercut = 0.075 * (1 - smoothstep(-0.1, 1.15, h))
      * (0.85 + 0.15 * Math.sin(angle * 5 + 0.8));
    const sides = radius - shore + undercut + shoulder * (fold * 0.003 + worn * 0.004);
    const roll = smoothstep(-0.07, 0, radius - shore);
    const crest = 0.028 + 0.057 * (0.5 + 0.5 * Math.sin(angle * 3 + 1.1));
    const roof = GO_SURFACE + shoulder * (crest + worn * 0.024 + fold * 0.003 - roll * 0.057);
    const sole = bottom + shoulder * (0.009 + worn * 0.009);
    let field = smoothMax(sides, y - roof, 0.014);
    field = smoothMax(field, sole - y, 0.024);
    for (const hole of holes) {
      const dx = x - hole.centre.x, dz = z - hole.centre.z;
      const u = dx * hole.c + dz * hole.s, v = -dx * hole.s + dz * hole.c;
      if (Math.abs(u) > hole.radiusX * 1.8 || Math.abs(v) > 0.22) continue;
      const depth = smoothstep(GO_SURFACE + 0.10, bottom, y);
      const twist = Math.sin(depth * 4 + hole.phase) * 0.006 * depth;
      const swell = 1 + 0.13 * Math.sin(depth * 5 + hole.phase);
      const a = (u + twist) / (hole.radiusX * (1 + depth * 0.16) * swell);
      const b = (v - twist) / (hole.radiusZ * (1 + depth * 0.38) * swell);
      const theta = Math.atan2(b, a);
      const irregular = 1 + 0.1 * Math.sin(theta * 3 + hole.phase) + 0.055 * Math.cos(theta * 5 - depth * 2);
      const eye = (Math.hypot(a, b) - irregular) * hole.radiusZ;
      // The chimney joins a side-facing grotto: actual daylight under an arch,
      // rather than a separate tube ending against an uncut outer wall.
      const grotto = (Math.hypot(u / (hole.radiusX * 1.24), (v - 0.045) / 0.145,
        (y - (bottom + 0.053)) / (0.038 + 0.006 * Math.sin(hole.phase))) - 1) * 0.037;
      field = smoothMax(field, -Math.min(eye, grotto), 0.016);
    }
    return field;
  };
}
