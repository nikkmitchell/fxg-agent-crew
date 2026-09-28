import { describe, expect, it } from "vitest";
import { breathMist } from "./FogMirror";

describe("the fog mirror", () => {
  it("mists only on the out-breath, and only close to the glass", () => {
    expect(breathMist(1, 0.1)).toBe(0);
    expect(breathMist(3.6, 0.1)).toBeGreaterThan(0.5);
    expect(breathMist(3.6, 0.5)).toBe(0);
  });
});
