import { describe, expect, it } from "vitest";
import { CIRCUIT_ORDER, LABYRINTH, circuitRadius, labyrinthPath } from "./labyrinth.js";

describe("the walking labyrinth", () => {
  it("visits every one of the seven circuits once, in the classical order", () => {
    expect([...CIRCUIT_ORDER].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(CIRCUIT_ORDER[0]).toBe(3);
    expect(CIRCUIT_ORDER.at(-1)).toBe(5);
  });

  it("starts outside the mouth, facing where people arrive, and ends in the centre", () => {
    const path = labyrinthPath();
    const first = path[0];
    expect(Math.hypot(first.x, first.z)).toBeGreaterThan(LABYRINTH.outer);
    expect(first.z).toBeLessThan(0);
    expect(path.at(-1)).toEqual({ x: 0, z: 0 });
  });

  it("stays inside its own outer circle apart from the way in, and never jumps", () => {
    const path = labyrinthPath();
    for (const point of path.slice(1)) expect(Math.hypot(point.x, point.z)).toBeLessThanOrEqual(LABYRINTH.outer + 1e-9);
    for (let i = 1; i < path.length; i += 1) {
      const hop = Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
      expect(hop).toBeLessThan(1.1);
    }
    expect(circuitRadius(7)).toBeGreaterThan(0.3);
  });
});
