import { describe, expect, it } from "vitest";
import { LIGHT_AT, ballBetween } from "./HoldTheLight";

const at = (dx: number, y = 1.2) => ({ x: LIGHT_AT.x + dx, y, z: LIGHT_AT.z });

describe("hold the light", () => {
  it("makes a ball between two hands held apart at the pedestal, bigger as they part", () => {
    const small = ballBetween(at(-0.05), at(0.05));
    const big = ballBetween(at(-0.2), at(0.2));
    expect(small).not.toBeNull();
    expect(big!.radius).toBeGreaterThan(small!.radius);
  });
  it("makes nothing away from the pedestal, with hands at the sides, or touching", () => {
    expect(ballBetween({ x: LIGHT_AT.x + 3, y: 1.2, z: LIGHT_AT.z }, { x: LIGHT_AT.x + 3.2, y: 1.2, z: LIGHT_AT.z })).toBeNull();
    expect(ballBetween(at(-0.1, 0.4), at(0.1, 0.4))).toBeNull();
    expect(ballBetween(at(-0.01), at(0.01))).toBeNull();
  });
});
