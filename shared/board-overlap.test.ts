import { describe, expect, it } from "vitest";
import { coverings, freeRow, rowPlaces, type Placed } from "./board-overlap";

const at = (label: string, x: number, y: number, w = 240, h = 240, z = 0): Placed => ({ label, x, y, w, h, z });

describe("what is covering what", () => {
  it("says nothing about a board laid out in a row", () => {
    expect(coverings([at("a", 0, 0), at("b", 320, 0), at("c", 640, 0)])).toEqual([]);
  });

  it("does not count items that merely touch", () => {
    // Edge to edge is a layout decision, not a mistake.
    expect(coverings([at("a", 0, 0), at("b", 240, 0)])).toEqual([]);
  });

  it("names the one on top first, and how much is hidden", () => {
    const found = coverings([at("photo", 0, 0, 400, 300, 1), at("swatch", 300, 100, 240, 240, 2)]);
    expect(found).toEqual([{ top: "swatch", under: "photo", wide: 100, tall: 200 }]);
  });

  /**
   * The real board, the night this was written: the candle described as the
   * quiet centre was across three photographs, and the palette covered two
   * more. Worst first, because that is the one to move.
   */
  it("puts the worst overlap first", () => {
    const found = coverings([
      at("horse", 40, 40, 380, 260, 1),
      at("buffalo", 450, 40, 380, 260, 2),
      at("candle", 650, 180, 240, 240, 9),
      at("night", 300, 80, 240, 240, 12),
    ]);
    expect(found[0].wide * found[0].tall).toBeGreaterThanOrEqual(found[1].wide * found[1].tall);
    expect(found.map((one) => `${one.top} over ${one.under}`)).toContain("candle over buffalo");
    expect(found.map((one) => `${one.top} over ${one.under}`)).toContain("night over horse");
  });

  it("does not invent a winner when two items share a z", () => {
    const found = coverings([at("first", 0, 0, 200, 200, 3), at("second", 100, 100, 200, 200, 3)]);
    expect(found).toHaveLength(1);
    expect(found[0].top, "the order they were given, not a guess").toBe("first");
  });
});

describe("where there is room", () => {
  it("is below everything already placed", () => {
    expect(freeRow([at("a", 0, 0, 380, 260), at("b", 40, 660, 800, 120)])).toBe(820);
  });

  it("is the gap itself on an empty board", () => {
    expect(freeRow([], 40)).toBe(40);
  });

  it("lays a row out left to right and wraps when the board runs out", () => {
    const places = rowPlaces(3, { y: 820 });
    expect(places).toEqual([
      { x: 100, y: 820 },
      { x: 420, y: 820 },
      { x: 740, y: 820 },
    ]);
    // Six at 320 apart from x=100 needs 2020 px; the board is 1800.
    const many = rowPlaces(7, { y: 820 });
    expect(many[6].y, "wrapped onto a second row").toBeGreaterThan(820);
  });

  it("never returns nothing to place", () => {
    expect(rowPlaces(1, { y: 0, width: 10 })).toHaveLength(1);
  });
});
