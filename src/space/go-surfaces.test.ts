import { describe, expect, it } from "vitest";
import { GO_COLOURS, GO_SURFACES, defaultGoItem, parseRoomItem, stepGoSurface, type GoSurface } from "../../shared/room-items.js";
import { GO_SURFACE_LOOKS, contrast } from "./go-surfaces.js";

/**
 * Board types: what is kept, and what every one of them must still show.
 * Contrast is WCAG's ratio — 1 is none, 21 is black on white.
 */

describe("board types on the table", () => {
  it("a table made before board types keeps its game and becomes bamboo", () => {
    const { surface: _gone, ...old } = { ...defaultGoItem("t"), stones: [{ x: 2, y: 2, colour: 0 }] };
    const upgraded = parseRoomItem(old);
    expect(upgraded?.surface).toBe("bamboo");
    expect(upgraded?.stones).toEqual([{ x: 2, y: 2, colour: 0 }]);
  });

  it("an unknown board type read back from storage falls back rather than losing the table", () => {
    expect(parseRoomItem({ ...defaultGoItem("t"), surface: "lava" })?.surface).toBe("bamboo");
  });

  it("steps go round in both directions and visit every type", () => {
    const seen = new Set<string>();
    let at: GoSurface = GO_SURFACES[0];
    for (let i = 0; i < GO_SURFACES.length; i += 1) { seen.add(at); at = stepGoSurface(at, 1); }
    expect(at).toBe(GO_SURFACES[0]);
    expect([...seen].sort()).toEqual([...GO_SURFACES].sort());
    for (const surface of GO_SURFACES) expect(stepGoSurface(stepGoSurface(surface, 1), -1)).toBe(surface);
  });
});

describe("every board type can still be read", () => {
  it("has a look for every type, with a label that fits the settings row", () => {
    for (const surface of GO_SURFACES) {
      expect(GO_SURFACE_LOOKS[surface], surface).toBeDefined();
      expect(GO_SURFACE_LOOKS[surface].label.length, surface).toBeLessThanOrEqual(7);
    }
  });

  it("gives each board its own bowls, as Baiwei asked: celadon with bamboo, red clay with stone", () => {
    const bamboo = GO_SURFACE_LOOKS.bamboo.bowl, stone = GO_SURFACE_LOOKS.stone.bowl;
    expect(bamboo.body).not.toBe(stone.body);
    // Celadon is a glaze: glossy. Red clay is unglazed: matte.
    expect(bamboo.clearcoat).toBeGreaterThan(stone.clearcoat);
    expect(bamboo.roughness).toBeLessThan(stone.roughness);
    // Celadon is green-blue; red clay is red.
    const rgb = (hex: string) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
    const [cr, cg] = rgb(bamboo.body);
    const [rr, rg] = rgb(stone.body);
    expect(cg).toBeGreaterThan(cr);
    expect(rr).toBeGreaterThan(rg);
    // Each carved differently: lotus petals on the celadon, a fret on the clay.
    expect(bamboo.relief).toBe("lotus");
    expect(stone.relief).toBe("fret");
  });

  it("the grid lines stand out from the surface", () => {
    for (const surface of GO_SURFACES) {
      const look = GO_SURFACE_LOOKS[surface];
      expect(contrast(look.lines, look.base), surface).toBeGreaterThanOrEqual(3);
    }
  });

  it("writing on the board can be read", () => {
    for (const surface of GO_SURFACES) {
      const look = GO_SURFACE_LOOKS[surface];
      expect(contrast(look.ink, look.base), `${surface} ink`).toBeGreaterThanOrEqual(3);
      expect(contrast(look.inkSoft, look.base), `${surface} soft ink`).toBeGreaterThanOrEqual(2.2);
    }
  });

  it("black and white stones both show on every surface — at least as well as white shows on bamboo today", () => {
    const today = contrast(GO_COLOURS[1], GO_SURFACE_LOOKS.bamboo.base);
    for (const surface of GO_SURFACES) {
      for (const stone of [GO_COLOURS[0], GO_COLOURS[1]]) {
        expect(contrast(stone, GO_SURFACE_LOOKS[surface].base), `${stone} on ${surface}`).toBeGreaterThanOrEqual(today);
      }
    }
  });
});
