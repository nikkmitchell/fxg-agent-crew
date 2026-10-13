import { describe, expect, it } from "vitest";
import { arrivalSpot } from "./arrive";

describe("arriving in a space beside whoever is there (Kerf, 2026-10-14)", () => {
  it("keeps the space's own spot when nobody is near it", () => {
    expect(arrivalSpot({ x: 0, z: 2 }, [{ x: 3, z: 2 }], 0)).toEqual({ x: 0, z: 2 });
  });

  it("steps to the right of where the space faces you when somebody stands on the spot", () => {
    const spot = arrivalSpot({ x: 0, z: 2 }, [{ x: 0.1, z: 2 }], 0);
    expect(spot.x).toBeCloseTo(0.9);
    expect(spot.z).toBeCloseTo(2);
  });

  it("goes left when the right is taken too, and turns with the space's facing", () => {
    const left = arrivalSpot({ x: 0, z: 0 }, [{ x: 0, z: 0 }, { x: 0.9, z: 0 }], 0);
    expect(left.x).toBeCloseTo(-0.9);
    // Facing a quarter turn left (rotation.y = +90°), your right is toward -z.
    const turned = arrivalSpot({ x: 0, z: 0 }, [{ x: 0, z: 0 }], Math.PI / 2);
    expect(turned.x).toBeCloseTo(0);
    expect(turned.z).toBeCloseTo(-0.9);
  });

  it("finds room further out in a crowd, and never lands within reach of anybody", () => {
    const crowd = [{ x: 0, z: 0 }];
    for (let k = 0; k < 8; k += 1) crowd.push({ x: Math.cos(k * Math.PI / 4) * 0.9, z: Math.sin(k * Math.PI / 4) * 0.9 });
    const spot = arrivalSpot({ x: 0, z: 0 }, crowd, 0);
    expect(Math.hypot(spot.x, spot.z)).toBeGreaterThan(1.5);
    for (const other of crowd) expect(Math.hypot(other.x - spot.x, other.z - spot.z)).toBeGreaterThanOrEqual(0.8);
  });
});
