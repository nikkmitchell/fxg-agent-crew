import { describe, expect, it } from "vitest";
import { GO_RIM_REACH, goBoardWidth } from "./go-layout.js";
import { GO_ROCK, goRockHoles, goRockOutline, type Point2 } from "./go-rock.js";
import { GO_SIZES } from "./room-items.js";

/**
 * The scholar's rock (card saha-ing-82be26cf): "keep the actual playable grid
 * plane flat, level, and fully clear; put holes and strongest silhouette
 * variation around the perimeter so no playable intersections are lost".
 */
const chebyshev = (p: Point2) => Math.max(Math.abs(p.x), Math.abs(p.z));

function inside(p: Point2, polygon: Point2[]): boolean {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) hit = !hit;
  }
  return hit;
}

function distanceToEdge(p: Point2, polygon: Point2[]): number {
  let best = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i], dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz)));
  }
  return best;
}

/** Points round a hole's edge. */
function rim(hole: ReturnType<typeof goRockHoles>[number]): Point2[] {
  const c = Math.cos(hole.angle), s = Math.sin(hole.angle);
  return Array.from({ length: 48 }, (_, k) => {
    const t = (k / 48) * Math.PI * 2, x = Math.cos(t) * hole.radiusX, z = Math.sin(t) * hole.radiusZ;
    return { x: hole.centre.x + x * c - z * s, z: hole.centre.z + x * s + z * c };
  });
}

describe("the scholar's rock", () => {
  it("grows only into the margin: never over the board, never past the rim's reach", () => {
    for (const size of GO_SIZES) {
      const half = goBoardWidth(size) / 2;
      const outline = goRockOutline(size);
      expect(outline).toHaveLength(GO_ROCK.points);
      for (const p of outline) {
        expect(chebyshev(p), `${size}x${size}`).toBeGreaterThanOrEqual(half + GO_ROCK.margin.min - 1e-9);
        expect(chebyshev(p), `${size}x${size}`).toBeLessThanOrEqual(half + GO_RIM_REACH + 1e-9);
      }
    }
  });

  it("is irregular: its margin really varies round the board", () => {
    for (const size of GO_SIZES) {
      const half = goBoardWidth(size) / 2;
      const margins = goRockOutline(size).map((p) => chebyshev(p) - half);
      expect(Math.max(...margins) - Math.min(...margins), `${size}x${size}`).toBeGreaterThan(0.035);
    }
  });

  it("has a few holes right through it, every one clear of the grid and with stone all round", () => {
    for (const size of GO_SIZES) {
      const half = goBoardWidth(size) / 2, outline = goRockOutline(size), holes = goRockHoles(size);
      expect(holes.length, `${size}x${size}`).toBeGreaterThanOrEqual(3);
      expect(holes.length).toBeLessThanOrEqual(GO_ROCK.holes);
      holes.forEach((hole, h) => {
        for (const p of rim(hole)) {
          const where = `${size}x${size} hole ${h}`;
          // Off the playing surface, which ends at the board's own edge.
          expect(chebyshev(p) - half, `${where}: off the board`).toBeGreaterThan(0.005);
          // Inside the rock, with stone left between the hole and the edge.
          expect(inside(p, outline), `${where}: inside the rock`).toBe(true);
          expect(distanceToEdge(p, outline), `${where}: not a notch`).toBeGreaterThan(0.004);
        }
      });
    }
  });

  it("is the same rock for everyone at the table", () => {
    expect(goRockOutline(9)).toEqual(goRockOutline(9));
    expect(goRockHoles(19)).toEqual(goRockHoles(19));
    expect(goRockOutline(9)).not.toEqual(goRockOutline(13).map((p) => p));
  });
});
