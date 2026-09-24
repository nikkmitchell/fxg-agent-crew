import { describe, expect, it } from "vitest";
import { GO_SURFACE_LOOKS } from "./go-surfaces";
import { bambooPixels, goTextureRepeat, GO_TILE_METRES, rockPixels, stonePixels } from "./go-textures";

/** Card saha-ing-67276601: richer grain, the same at every board size, and calm. */
const SIZE = 512; // the size RoomItems uses
const textures = {
  bamboo: bambooPixels(SIZE, GO_SURFACE_LOOKS.bamboo.base),
  stone: stonePixels(SIZE, GO_SURFACE_LOOKS.stone.base),
  rock: rockPixels(SIZE, GO_SURFACE_LOOKS.rock.base),
};
const lum = (p: Uint8ClampedArray, x: number, y: number) => {
  const at = ((y % SIZE) * SIZE + (x % SIZE)) * 4;
  return 0.2126 * p[at] + 0.7152 * p[at + 1] + 0.0722 * p[at + 2];
};
const baseLum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

describe("the Go board's grain", () => {
  it("is the same size on every board: tiles repeat by the metre", () => {
    expect(goTextureRepeat(GO_TILE_METRES)).toBe(1);
    // 5x5 and 25x25 differ in width, not in how big a centimetre of grain is.
    expect(goTextureRepeat(2.0) / goTextureRepeat(0.5)).toBeCloseTo(4);
  });

  for (const [name, pixels] of Object.entries(textures)) {
    it(`${name}: tiles with no seam`, () => {
      // Crossing the tile's edge must look like any other step between neighbours.
      let inside = 0, across = 0, acrossRows = 0;
      for (let i = 0; i < SIZE; i++) {
        inside += Math.abs(lum(pixels, SIZE / 2, i) - lum(pixels, SIZE / 2 + 1, i));
        across += Math.abs(lum(pixels, SIZE - 1, i) - lum(pixels, 0, i));
        acrossRows += Math.abs(lum(pixels, i, SIZE - 1) - lum(pixels, i, 0));
      }
      expect(across / SIZE).toBeLessThan(inside / SIZE * 2.5 + 0.5);
      expect(acrossRows / SIZE).toBeLessThan(inside / SIZE * 2.5 + 0.5);
    });

    it(`${name}: averages to the colour the contrast checks use`, () => {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) sum += lum(pixels, x, y);
      const look = GO_SURFACE_LOOKS[name as "bamboo" | "stone" | "rock"];
      expect(Math.abs(sum / SIZE / SIZE - baseLum(look.base))).toBeLessThan(6);
    });

    it(`${name}: is calm, not pixel noise`, () => {
      // Average step between neighbouring pixels, in 0-255 grey levels: small,
      // so a headset does not shimmer; and a real spread across the tile, so
      // there IS grain.
      let step = 0, min = 255, max = 0;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const l = lum(pixels, x, y);
        step += Math.abs(l - lum(pixels, x + 1, y));
        min = Math.min(min, l); max = Math.max(max, l);
      }
      expect(step / SIZE / SIZE).toBeLessThan(4);
      expect(max - min).toBeGreaterThan(12);
    });
  }
});
