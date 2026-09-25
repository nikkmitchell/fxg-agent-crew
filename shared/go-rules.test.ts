import { describe, expect, it } from "vitest";
import { legalGoMoves, placeGoStone } from "./go-rules";
import { defaultGoItem, parseRoomItem, GO_SIZES, type GoStone } from "./room-items";
import { goBowl, goLocal, goTouchBowl, goTouchIntersection, goWorld, GO_SURFACE, GO_PITCH, goPoint, goRadius, goBoardWidth, goDeckWidth } from "./go-layout";
const s = (x: number, y: number, colour = 1): GoStone => ({ x, y, colour });
describe("Go captures", () => {
  it("captures one surrounded stone and does not mutate the input", () => {
    const board = [s(2, 2), s(1, 2, 0), s(3, 2, 0), s(2, 1, 0)];
    expect(placeGoStone(board, 5, s(2, 3, 0))).toEqual({ stones: [...board.slice(1), s(2, 3, 0)], captured: [s(2, 2)], ko: null });
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
  it("keeps every bowl outside the playing surface and on the deck", () => {
    // The capture rings have their own test: go-capture-ring.test.ts.
    for (const size of GO_SIZES) for (let count = 2; count <= 8; count++) for (let i = 0; i < count; i++) {
      const bowl = goBowl(i, count, size);
      expect(Math.max(Math.abs(bowl.x), Math.abs(bowl.z)) - 0.18).toBeGreaterThan(goBoardWidth(size) / 2);
      expect(Math.max(Math.abs(bowl.x), Math.abs(bowl.z)) + 0.18).toBeLessThan(goDeckWidth(size, count) / 2);
    }
  });
  it("upgrades a persisted original table without changing stones", () => {
    const item = defaultGoItem("old");
    const { captures: _c, carrier: _h, scale: _s, revision: _r, deskVisible: _d, ...old } = item;
    expect(parseRoomItem({ ...old, position: { x: 1, z: 2, rotationY: 0 } })).toMatchObject({ captures: [], carrier: null, scale: 1, revision: 0, deskVisible: true, position: { y: 0 } });
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

/** Nikk (4826): the other player could capture straight back. Simple ko. */
describe("ko", () => {
  // A classic ko on a 5x5, around (2,2):
  //   . B W .
  //   B W . W     black to play at (2,1) captures the white stone at (1,1)?
  // Built explicitly: black stones surround (1,1) on three sides, white surrounds (2,1) on three.
  const B = 0, W = 1;
  const at = (x: number, y: number, colour: number) => ({ x, y, colour });
  const start = [
    at(1, 0, B), at(0, 1, B), at(1, 2, B),      // black round (1,1)
    at(2, 0, W), at(3, 1, W), at(2, 2, W),      // white round (2,1)
    at(1, 1, W),                                 // the white stone in the ko
  ];

  it("closes the point for one move after a single-stone capture", () => {
    const take = placeGoStone(start, 5, at(2, 1, B));
    if ("error" in take) throw new Error(take.error);
    expect(take.captured.map((s) => [s.x, s.y])).toEqual([[1, 1]]);
    expect(take.ko).toEqual({ x: 1, y: 1 });
    const retake = placeGoStone(take.stones, 5, at(1, 1, W), take.ko);
    expect(retake).toHaveProperty("error");
    expect((retake as { error: string }).error).toMatch(/Ko/);
    expect(legalGoMoves(take.stones, 5, W, take.ko)).not.toContainEqual({ x: 1, y: 1 });
  });

  it("opens again once another move has been played", () => {
    const take = placeGoStone(start, 5, at(2, 1, B)) as { stones: never[]; ko: { x: number; y: number } };
    const elsewhere = placeGoStone(take.stones, 5, at(4, 4, W), take.ko) as { stones: never[]; ko: null };
    expect(elsewhere.ko).toBeNull();
    const black = placeGoStone(elsewhere.stones, 5, at(4, 0, B), elsewhere.ko) as { stones: never[]; ko: null };
    expect(placeGoStone(black.stones, 5, at(1, 1, W), black.ko)).not.toHaveProperty("error");
  });

  it("is not ko when a capture takes more than one stone", () => {
    const two = [at(0, 0, W), at(1, 0, W), at(0, 1, B), at(1, 1, B)];
    const take = placeGoStone(two, 5, at(2, 0, B));
    if ("error" in take) throw new Error(take.error);
    expect(take.captured).toHaveLength(2);
    expect(take.ko).toBeNull();
  });
});
