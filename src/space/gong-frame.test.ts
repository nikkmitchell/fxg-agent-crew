import { afterEach, describe, expect, it } from "vitest";
import { GONG_AT, gongFrameGeometry } from "./GongStand";

describe("the gong's merged wooden frame", () => {
  let geometry: ReturnType<typeof gongFrameGeometry> | undefined;
  afterEach(() => {
    geometry?.dispose();
    geometry = undefined;
  });

  it("keeps all five frame pieces in one geometry with the original bounds", () => {
    geometry = gongFrameGeometry();
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    const post = GONG_AT.radius + 0.12;

    expect(geometry.getAttribute("position").count).toBe(5 * 24);
    expect(bounds.min.x).toBeCloseTo(-(post + 0.1));
    expect(bounds.max.x).toBeCloseTo(post + 0.1);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(1.86);
    expect(bounds.min.z).toBeCloseTo(-0.25);
    expect(bounds.max.z).toBeCloseTo(0.25);
  });
});
