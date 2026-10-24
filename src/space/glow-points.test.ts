import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { disposeGlowPoints, glowPoints } from "./glow-points";

describe("a pooled cloud of glowing points", () => {
  it("starts hidden and faded out, glows additively, and its positions are the geometry's own", () => {
    const { points, positions } = glowPoints(5, "#8fd8ff", 0.045);
    const material = points.material as THREE.PointsMaterial;
    expect([points.visible, points.frustumCulled]).toEqual([false, false]);
    expect([material.opacity, material.transparent, material.depthWrite, material.blending]).toEqual([0, true, false, THREE.AdditiveBlending]);
    expect(material.color.getHexString()).toBe("8fd8ff");
    expect(material.size).toBe(0.045);
    expect(positions).toHaveLength(15);
    // The effect writes into `positions` and flags the attribute: they must be one array.
    expect((points.geometry.getAttribute("position") as THREE.BufferAttribute).array).toBe(positions);
  });

  it("frees its geometry and material", () => {
    const { points } = glowPoints(1, "#ffd23f", 0.06);
    const freed: string[] = [];
    points.geometry.addEventListener("dispose", () => freed.push("geometry"));
    (points.material as THREE.Material).addEventListener("dispose", () => freed.push("material"));
    disposeGlowPoints(points);
    expect(freed).toEqual(["geometry", "material"]);
  });
});
