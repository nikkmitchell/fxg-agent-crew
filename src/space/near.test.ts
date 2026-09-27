import { describe, expect, it } from "vitest";
import { isNear } from "./Near";

describe("drawn only when near", () => {
  it("draws a piece within reach across the floor, and hides it further away", () => {
    expect(isNear({ x: 0, z: 0 }, { x: 3, z: 4 }, 7)).toBe(true);
    expect(isNear({ x: 0, z: 0 }, { x: 6, z: 6 }, 7)).toBe(false);
  });
});
