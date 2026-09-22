import { describe, expect, it } from "vitest";
import { legalGoMoves, placeGoStone } from "./go-rules";
import { defaultGoItem, parseRoomItem, GO_SIZES, type GoStone } from "./room-items";
import { goBowl, goLocal, goTouchBowl, goTouchIntersection, goWorld, GO_SURFACE, GO_PITCH, goPoint, goRadius, goBoardWidth, goDeckWidth, goTray } from "./go-layout";
const s = (x: number, y: number, colour = 1): GoStone => ({ x, y, colour });
describe("Go captures", () => {
  it("captures one surrounded stone and does not mutate the input", () => {
    const board = [s(2, 2), s(1, 2, 0), s(3, 2, 0), s(2, 1, 0)];
    expect(placeGoStone(board, 5, s(2, 3, 0))).toEqual({ stones: [...board.slice(1), s(2, 3, 0)], captured: [s(2, 2)] });
    expect(board).toHaveLength(4);
  });
  it("removes an entire orthogonally connected group", () => {
    const board = [s(1, 1), s(1, 2), s(0, 1, 0), s(2, 1, 0), s(1, 0, 0), s(0, 2, 0), s(2, 2, 0)];
    const move = placeGoStone(board, 5, s(1, 3, 0));
    expect(move).not.toHaveProperty("error");
    if (!("error" in move)) expect(move.captured).toEqual(expect.arrayContaining([s(1, 1), s(1, 2)]));
  });
  it("preserves a group with a liberty even if one stone is locally surrounded", () => {
    expect(placeGoStone([s(1, 1), s(1, 2), s(0, 1, 0), s(2, 1, 0)], 5, s(1, 0, 0))).toMatchObject({ captured: [] });
  });
  it("uses the board edge and corner as boundaries", () => {
    expect(placeGoStone([s(0, 0), s(1, 0, 0)], 5, s(0, 1, 0))).toMatchObject({ captured: [s(0, 0)] });
    expect(placeGoStone([s(0, 2), s(0, 1, 0), s(0, 3, 0)], 5, s(1, 2, 0))).toMatchObject({ captured: [s(0, 2)] });
  });
  it("does not join diagonal stones and accepts mixed-colour surrounds", () => {
    expect(placeGoStone([s(0, 0, 2), s(1, 1, 2), s(1, 0, 1)], 5, s(0, 1, 0))).toMatchObject({ captured: [s(0, 0, 2)] });
  });
  it("captures simultaneous enemy groups", () => {
    const board = [s(0, 0, 1), s(2, 0, 2), s(0, 1, 0), s(2, 1, 0), s(3, 0, 0)];
    const move = placeGoStone(board, 5, s(1, 0, 0));
    if ("error" in move) throw Error(move.error);
    expect(move.captured).toHaveLength(2);
  });
  it("rejects self-capture but allows a capturing move to create its own liberty", () => {
    expect(placeGoStone([s(0, 1), s(1, 0)], 5, s(0, 0, 0))).toHaveProperty("error");
    expect(placeGoStone([s(0, 1), s(1, 0), s(0, 2, 0), s(1, 1, 0), s(2, 0, 0)], 5, s(0, 0, 0))).toHaveProperty("captured");
  });
  it("highlights only legal empty intersections", () => {
    const moves = legalGoMoves([s(0, 1), s(1, 0)], 5, 0);
    expect(moves).not.toContainEqual({ x: 0, y: 0 });
    expect(moves).not.toContainEqual({ x: 0, y: 1 });
    expect(moves).toContainEqual({ x: 2, y: 2 });
    for (const x of [-1, 5, 1.5, NaN]) expect(placeGoStone([], 5, s(x, 0))).toHaveProperty("error");
  });
});
describe("Go layout", () => {
  it("grows the physical board while keeping identical grid pitch and stones at every size", () => {
    for (const size of GO_SIZES) {
      expect(goPoint(1, size) - goPoint(0, size)).toBeCloseTo(GO_PITCH);
      expect(goPoint(size - 1, size) - goPoint(0, size)).toBeCloseTo((size - 1) * GO_PITCH);
      expect(goRadius(size)).toBe(goRadius(9));
      expect(goBoardWidth(size)).toBeCloseTo((size - 1) * GO_PITCH + 0.2);
      const corner = { x: goPoint(size - 1, size), y: GO_SURFACE + 0.03, z: goPoint(0, size) };
      expect(goTouchIntersection(corner, size)).toEqual({ x: size - 1, y: 0 });
    }
    expect(goBoardWidth(25)).toBeGreaterThan(goBoardWidth(19));
    expect(goBoardWidth(9)).toBeGreaterThan(goBoardWidth(5));
  });
  it("keeps capture trays clear of every bowl at all grid sizes and colour counts", () => {
    for (const size of GO_SIZES) for (let count = 2; count <= 8; count++) for (let i = 0; i < count; i++) {
      const tray = goTray(i, count, size);
      for (let j = 0; j < count; j++) {
        const bowl = goBowl(j, count, size);
        const dx = Math.max(0, Math.abs(tray.x - bowl.x) - 0.11);
        const dz = Math.max(0, Math.abs(tray.z - bowl.z) - 0.135);
        expect(Math.hypot(dx, dz) - 0.18, `${size}x${size}/${count}: tray${i} bowl${j}`).toBeGreaterThan(0.01);
      }
    }
  });
  it("keeps every bowl outside the playing surface and each tray on the deck", () => {
    for (const size of GO_SIZES) for (let count = 2; count <= 8; count++) for (let i = 0; i < count; i++) {
      const bowl = goBowl(i, count, size), tray = goTray(i, count, size);
      expect(Math.max(Math.abs(bowl.x), Math.abs(bowl.z)) - 0.18).toBeGreaterThan(goBoardWidth(size) / 2);
      expect(Math.abs(tray.x) + 0.11).toBeLessThan(goDeckWidth(size, count) / 2);
      expect(Math.abs(tray.z) + 0.135).toBeLessThan(goDeckWidth(size, count) / 2);
    }
  });
  it("upgrades a persisted original table without changing stones", () => {
    const item = defaultGoItem("old");
    const { captures: _c, carrier: _h, scale: _s, revision: _r, ...old } = item;
    expect(parseRoomItem({ ...old, position: { x: 1, z: 2, rotationY: 0 } })).toMatchObject({ captures: [], carrier: null, scale: 1, revision: 0, position: { y: 0 } });
  });
  it("round trips translated, rotated and resized contact coordinates", () => {
    const item = { ...defaultGoItem("test"), position: { x: 2, y: 0.8, z: -3, rotationY: 0.7 }, scale: 1.6 };
    const p = { x: 0.2, y: 0.9, z: -0.1 }, result = goLocal(goWorld(p, item), item);
    expect(result.x).toBeCloseTo(p.x); expect(result.y).toBeCloseTo(p.y); expect(result.z).toBeCloseTo(p.z);
  });
  it("recognizes only the active bowl and near-surface intersections", () => {
    const item = defaultGoItem("test");
    expect(goTouchBowl(goBowl(0, 2), item)).toBe(true);
    expect(goTouchBowl(goBowl(1, 2), item)).toBe(false);
    expect(goTouchIntersection({ x: 0, y: GO_SURFACE + 0.03, z: 0 }, 9)).toEqual({ x: 4, y: 4 });
    expect(goTouchIntersection({ x: 0, y: 1.2, z: 0 }, 9)).toBeNull();
    expect(goTouchIntersection({ x: 0.7, y: GO_SURFACE, z: 0 }, 9)).toBeNull();
  });
});
