import { describe, expect, it } from "vitest";
import { goBoardWidth } from "./go-layout.js";
import { goRockHoles, goRockOutline } from "./go-rock.js";
import { GO_ROCK_BODY_TOP, GO_ROCK_HOLE_DEPTH, goRockBody, goRockField } from "./go-rock-body.js";
import { GO_SIZES } from "./room-items.js";

/**
 * Baiwei: "a scholar stone ... not only on the top, but the rest of it is
 * filled with holes ... low poly". Pixels are not proof, so these check the
 * stone's shape itself.
 */
const bodies = new Map(GO_SIZES.map((size) => [size, goRockBody(size)]));

function inside(p: { x: number; z: number }, polygon: { x: number; z: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

describe("the scholar's stone body", () => {
  it("stands from the floor to just under the flat top, and never past the top's outline", () => {
    for (const size of GO_SIZES) {
      const tris = bodies.get(size)!, lip = goRockOutline(size);
      let low = Infinity, high = -Infinity;
      for (let v = 0; v < tris.length; v += 3) {
        low = Math.min(low, tris[v + 1]); high = Math.max(high, tris[v + 1]);
        // A vertex may sit a hair outside the ring: it is an average of edge crossings.
        const p = { x: tris[v] * 0.97, z: tris[v + 2] * 0.97 };
        expect(inside(p, lip), `${size}x${size} vertex ${v / 3} outside the lip`).toBe(true);
      }
      expect(low, `${size}x${size} foot`).toBeLessThan(0.02);
      expect(high, `${size}x${size} top`).toBeLessThanOrEqual(GO_ROCK_BODY_TOP + 1e-6);
      expect(high, `${size}x${size} top`).toBeGreaterThan(GO_ROCK_BODY_TOP - 0.01);
    }
  });

  it("is low-poly: a few thousand faces, not a smooth mesh", () => {
    for (const size of GO_SIZES) {
      const faces = bodies.get(size)!.length / 9;
      expect(faces, `${size}x${size}`).toBeGreaterThan(300);
      expect(faces, `${size}x${size}`).toBeLessThan(20000);
    }
  });

  it("is worn through: at every height band there is air inside its outline", () => {
    for (const size of GO_SIZES) {
      const field = goRockField(size), half = goBoardWidth(size) / 2;
      // Holes all the way down, not only at the top.
      for (const [from, to] of [[0.05, 0.3], [0.3, 0.55], [0.55, 0.78]]) {
        let air = 0, stone = 0;
        for (let y = from; y < to; y += 0.02) for (let x = -half * 0.45; x <= half * 0.45; x += 0.02)
          for (let z = -half * 0.45; z <= half * 0.45; z += 0.02) field([x, y, z]) < 0 ? stone++ : air++;
        expect(stone, `${size}x${size} ${from}-${to}: some stone`).toBeGreaterThan(0);
        expect(air / (air + stone), `${size}x${size} ${from}-${to}: some hollow`).toBeGreaterThan(0.08);
      }
    }
  });

  it("carries the top: under the slab it is solid across most of the board", () => {
    for (const size of GO_SIZES) {
      const field = goRockField(size), half = goBoardWidth(size) / 2, y = GO_ROCK_BODY_TOP - 0.01;
      let solid = 0, total = 0;
      for (let x = -half * 0.9; x <= half * 0.9; x += 0.02) for (let z = -half * 0.9; z <= half * 0.9; z += 0.02) {
        total++; if (field([x, y, z]) < 0) solid++;
      }
      expect(solid / total, `${size}x${size}`).toBeGreaterThan(0.85);
    }
  });

  it("faces out: every face's normal points from stone to air", () => {
    for (const size of [9, 19] as const) {
      const tris = bodies.get(size)!, field = goRockField(size);
      let out = 0, total = 0;
      for (let f = 0; f < tris.length; f += 9) {
        const a = tris.slice(f, f + 3), b = tris.slice(f + 3, f + 6), c = tris.slice(f + 6, f + 9);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const len = Math.hypot(...n);
        if (len < 1e-9) continue;
        const m = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        const e = 0.004;
        const ahead = field([m[0] + (n[0] / len) * e, m[1] + (n[1] / len) * e, m[2] + (n[2] / len) * e]);
        const behind = field([m[0] - (n[0] / len) * e, m[1] - (n[1] / len) * e, m[2] - (n[2] / len) * e]);
        total++; if (ahead > behind) out++;
      }
      expect(out / total, `${size}x${size}`).toBeGreaterThan(0.95);
    }
  });

  it("carries every rim hole down through the stone: a perforation, not a pit", () => {
    for (const size of GO_SIZES) {
      const field = goRockField(size);
      for (const hole of goRockHoles(size)) {
        // Air straight down the hole's middle, the whole way it runs.
        for (let y = GO_ROCK_BODY_TOP - 0.005; y > GO_ROCK_BODY_TOP - GO_ROCK_HOLE_DEPTH; y -= 0.01)
          expect(field([hole.centre.x, y, hole.centre.z]), `${size}x${size} hole at ${y.toFixed(2)}`).toBeGreaterThan(0);
      }
    }
  });

  it("is one piece: no stone floats free of the rest", () => {
    for (const size of GO_SIZES) {
      const field = goRockField(size), half = goBoardWidth(size) / 2 + 0.05, step = 0.015;
      const n = Math.ceil((half * 2) / step), ny = Math.ceil(GO_ROCK_BODY_TOP / step) + 1;
      const solid = new Uint8Array(n * n * ny), id = (i: number, j: number, k: number) => (j * n + k) * n + i;
      let total = 0;
      for (let j = 0; j < ny; j++) for (let k = 0; k < n; k++) for (let i = 0; i < n; i++)
        if (field([-half + i * step, Math.min(j * step, GO_ROCK_BODY_TOP - 1e-4), -half + k * step]) < 0) { solid[id(i, j, k)] = 1; total++; }
      // Flood from the top layer, which is the slab's seat.
      const seen = new Uint8Array(solid.length), stack: number[] = [];
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (solid[id(i, ny - 1, k)]) { seen[id(i, ny - 1, k)] = 1; stack.push(id(i, ny - 1, k)); }
      let reached = stack.length;
      while (stack.length) {
        const c = stack.pop()!, i = c % n, k = Math.floor(c / n) % n, j = Math.floor(c / (n * n));
        for (const [a, b, d] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const x = i + a, y = j + b, z = k + d;
          if (x < 0 || y < 0 || z < 0 || x >= n || y >= ny || z >= n) continue;
          const e = id(x, y, z);
          if (solid[e] && !seen[e]) { seen[e] = 1; reached++; stack.push(e); }
        }
      }
      expect(reached / total, `${size}x${size}: share of the stone joined to its top`).toBeGreaterThan(0.995);
      // And it reaches the floor, so it stands.
      let foot = 0;
      for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) if (seen[id(i, 1, k)]) foot++;
      expect(foot, `${size}x${size}: standing on the floor`).toBeGreaterThan(20);
    }
  });

  it("is the same stone for everyone", () => {
    expect(goRockBody(9)).toEqual(bodies.get(9));
  });
});
