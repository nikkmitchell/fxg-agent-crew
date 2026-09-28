import { describe, expect, it } from "vitest";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { bloomParts } from "./IkebanaVase";

describe("the ikebana arrangement", () => {
  it("merges every stem, petal and centre into one geometry", () => {
    const parts = [
      ...bloomParts({ flower: 0, x: 0.1, y: 0.3, z: 0 } as never),
      ...bloomParts({ flower: 2, x: -0.1, y: 0.25, z: 0.05 } as never),
    ];
    expect(parts).toHaveLength(16);
    const merged = mergeGeometries(parts);
    expect(merged).not.toBeNull();
    expect(merged!.getAttribute("color").count).toBe(merged!.getAttribute("position").count);
  });
});
