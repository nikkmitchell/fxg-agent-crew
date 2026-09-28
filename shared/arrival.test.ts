import { describe, expect, it } from "vitest";
import { ARRIVAL_CLEARANCE, arrivalSpot, boardFootprint, distanceToSegment, isClearForArrival } from "./arrival";

const spawn = { x: 0, z: 6.2 };

describe("where a person appears on joining (Nikk, 2026-09-28)", () => {
  it("keeps the spawn point when nobody and nothing is within a metre", () => {
    expect(arrivalSpot(spawn, [{ x: 3, z: 6 }])).toEqual(spawn);
  });
  it("moves off someone standing on the spawn point, to a metre away", () => {
    const spot = arrivalSpot(spawn, [spawn]);
    expect(Math.hypot(spot.x - spawn.x, spot.z - spawn.z)).toBeGreaterThanOrEqual(ARRIVAL_CLEARANCE);
    expect(isClearForArrival(spot, [spawn], [])).toBe(true);
  });
  it("finds room in a crowd, clear of every one of them", () => {
    const crowd = [spawn, { x: 0.6, z: 6.2 }, { x: -0.6, z: 6.2 }, { x: 0, z: 5.6 }, { x: 0, z: 6.8 }];
    const spot = arrivalSpot(spawn, crowd);
    expect(isClearForArrival(spot, crowd, [])).toBe(true);
  });
  it("keeps a metre from a board as well as from people", () => {
    const board = boardFootprint({ x: 0, z: 6.2 }, 4, 0);
    expect(distanceToSegment(spawn, board)).toBe(0);
    const spot = arrivalSpot(spawn, [], [board]);
    expect(distanceToSegment(spot, board)).toBeGreaterThanOrEqual(ARRIVAL_CLEARANCE);
  });
});
