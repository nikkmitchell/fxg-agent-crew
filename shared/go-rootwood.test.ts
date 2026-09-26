import { describe, expect, it } from "vitest";
import { GO_SIZES } from "./room-items.js";
import { ROOTWOOD_TOP, rootwoodField, rootwoodHalf, rootwoodMesh } from "./go-rootwood.js";

/**
 * The rootwood throne (saha-ing-c1fd1ba9). Pixels are not proof, so these
 * check the wood itself: that it stays where the rest of the table needs it
 * to, that it is one piece that stands, and that it holds the top up at the
 * edges like roots rather than as a solid stump.
 */
const meshes = new Map(GO_SIZES.map((size) => [size, rootwoodMesh(size)]));

describe("the rootwood throne", () => {
  it("stays under the flat top and inside its square, so the bowls stay clear", () => {
    for (const size of GO_SIZES) {
      const tris = meshes.get(size)!, half = rootwoodHalf(size);
      let low = Infinity, high = -Infinity;
      for (let v = 0; v < tris.length; v += 3) {
        low = Math.min(low, tris[v + 1]);
        high = Math.max(high, tris[v + 1]);
        expect(Math.max(Math.abs(tris[v]), Math.abs(tris[v + 2])), `${size}x${size}`).toBeLessThanOrEqual(half + 1e-6);
      }
      expect(low, `${size}x${size} stands on the floor`).toBeLessThan(0.02);
      expect(high, `${size}x${size} reaches the top`).toBeGreaterThan(ROOTWOOD_TOP - 0.01);
      expect(high).toBeLessThanOrEqual(ROOTWOOD_TOP + 1e-6);
    }
  });

  it("is low-poly and cheap in a headset: a few thousand faces at any size", () => {
    for (const size of GO_SIZES) {
      const faces = meshes.get(size)!.length / 9;
      expect(faces, `${size}x${size}`).toBeGreaterThan(300);
      expect(faces, `${size}x${size}`).toBeLessThan(15000);
    }
  });

  it("holds the top with roots, not a solid stump: wood near the edges, air between", () => {
    for (const size of GO_SIZES) {
      const field = rootwoodField(size), half = rootwoodHalf(size), y = ROOTWOOD_TOP - 0.02;
      let wood = 0, air = 0;
      for (let a = 0; a < 360; a += 2) {
        const t = (a * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
        const out = (half * 0.85) / Math.max(Math.abs(c), Math.abs(s));
        field([c * out, y, s * out]) < 0 ? wood++ : air++;
      }
      expect(wood, `${size}x${size}: roots reach the edge`).toBeGreaterThan(5);
      expect(air / (wood + air), `${size}x${size}: with air between them`).toBeGreaterThan(0.4);
    }
  });

  it("narrows to a waist and flares again at the foot", () => {
    for (const size of GO_SIZES) {
      const field = rootwoodField(size), half = rootwoodHalf(size);
      const widthAt = (y: number) => {
        let widest = 0;
        for (let x = 0; x <= half; x += 0.005) if (field([x, y, 0]) < 0 || field([-x, y, 0]) < 0 || field([0, y, x]) < 0 || field([0, y, -x]) < 0) widest = x;
        return widest;
      };
      const waist = widthAt(ROOTWOOD_TOP * 0.42), foot = widthAt(0.03), crown = widthAt(ROOTWOOD_TOP * 0.8);
      expect(foot, `${size}x${size} foot wider than waist`).toBeGreaterThan(waist);
      expect(crown, `${size}x${size} crown wider than waist`).toBeGreaterThan(waist);
    }
  });

  it("is the same wood for everyone, and different at each size", () => {
    expect(rootwoodMesh(9)).toEqual(meshes.get(9));
    expect(rootwoodMesh(9)).not.toEqual(meshes.get(13));
  });
});
