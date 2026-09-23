import { describe, expect, it } from "vitest";
import { GO_PITCH, goBoardWidth, goPoint } from "../../shared/go-layout.js";
import { GO_SIZES } from "../../shared/room-items.js";
import { GO_SNAP_REACH, goSnap, type GoMove } from "./go-snap.js";

/** Every intersection of an empty board. */
const everyPoint = (size: number): GoMove[] =>
  Array.from({ length: size * size }, (_, i) => ({ x: i % size, y: Math.floor(i / size) }));
const at = (move: GoMove, size: number, dx = 0, dz = 0) => ({ x: goPoint(move.x, size) + dx, z: goPoint(move.y, size) + dz });

describe("the magnet: where a held stone will land", () => {
  it("lands exactly on the intersection pointed at", () => {
    for (const size of GO_SIZES) {
      for (const move of everyPoint(size)) expect(goSnap(at(move, size), everyPoint(size), size)).toEqual(move);
    }
  });

  it("leaves no dead space: anywhere on the grid snaps to the NEAREST free point", () => {
    // Sampled finely across the whole grid, including the middle of squares —
    // the places a dot-only board pressed nothing.
    const size = 9, moves = everyPoint(size), step = GO_PITCH / 7;
    const low = goPoint(0, size), high = goPoint(size - 1, size);
    for (let x = low; x <= high + 1e-9; x += step) {
      for (let z = low; z <= high + 1e-9; z += step) {
        const snapped = goSnap({ x, z }, moves, size);
        expect(snapped, `(${x.toFixed(3)}, ${z.toFixed(3)})`).not.toBeNull();
        const nearest = Math.min(...moves.map((m) => Math.hypot(goPoint(m.x, size) - x, goPoint(m.y, size) - z)));
        expect(Math.hypot(goPoint(snapped!.x, size) - x, goPoint(snapped!.y, size) - z)).toBeCloseTo(nearest, 9);
      }
    }
  });

  it("pointing AT a stone lands nowhere — never on the free point beside it", () => {
    const size = 9, stone = { x: 4, y: 4 };
    const free = everyPoint(size).filter((m) => m.x !== stone.x || m.y !== stone.y);
    expect(goSnap(at(stone, size), free, size)).toBeNull();
    // A little off-centre on the stone, still nowhere.
    expect(goSnap(at(stone, size, GO_PITCH * 0.2, -GO_PITCH * 0.2), free, size)).toBeNull();
  });

  it("only ever answers a move it was offered", () => {
    const size = 13, offered = [{ x: 2, y: 3 }, { x: 10, y: 10 }];
    const answer = goSnap(at({ x: 2, y: 3 }, size, 0.01, 0.01), offered, size);
    expect(offered).toContainEqual(answer);
  });

  it("does not reach out into the board's margin", () => {
    for (const size of GO_SIZES) {
      const edge = goBoardWidth(size) / 2 - 0.01; // near the rim, well past the last line
      expect(goSnap({ x: edge, z: 0 }, everyPoint(size), size), `${size}x${size}`).toBeNull();
    }
  });

  it("the reach covers the middle of a square, and stops short of a whole pitch", () => {
    expect(GO_SNAP_REACH).toBeGreaterThan(GO_PITCH * Math.SQRT1_2);
    expect(GO_SNAP_REACH).toBeLessThan(GO_PITCH);
  });

  it("gives the same answer for the same point every time, even on an exact tie", () => {
    const size = 9, moves = everyPoint(size);
    const middle = { x: (goPoint(3, size) + goPoint(4, size)) / 2, z: (goPoint(3, size) + goPoint(4, size)) / 2 };
    const first = goSnap(middle, moves, size);
    for (let i = 0; i < 5; i += 1) expect(goSnap(middle, moves, size)).toEqual(first);
  });
});
