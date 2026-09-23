import { describe, expect, it } from "vitest";
import { GO_SIZES, defaultGoItem, type GoRoomItem } from "./room-items.js";
import { GO_COLUMNS, GO_GLYPHS, GO_NAMES, goBoardText, goColourOf, goCoordName, goStarPoints, parseGoCoord } from "./go-text.js";

const table = (over: Partial<GoRoomItem> = {}): GoRoomItem => ({ ...defaultGoItem("t"), ...over });

describe("Go coordinates", () => {
  it("has a column letter for the biggest board, and never uses I", () => {
    expect(GO_COLUMNS).toHaveLength(Math.max(...GO_SIZES));
    expect(GO_COLUMNS).not.toContain("I");
  });

  it("goes there and back for every point of every size", () => {
    for (const size of GO_SIZES) {
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) expect(parseGoCoord(goCoordName(x, y, size), size)).toEqual({ x, y });
      }
    }
  });

  it("counts rows up from the near side, where the turn line is read", () => {
    // Row 1 is the row nearest the person reading the table: the table's
    // largest y. A1 is the near-left corner.
    expect(parseGoCoord("A1", 9)).toEqual({ x: 0, y: 8 });
    expect(parseGoCoord("J9", 9)).toEqual({ x: 8, y: 0 });
    expect(goCoordName(3, 5, 9)).toBe("D4");
  });

  it("takes any case and stray spaces, and refuses what is not on this board", () => {
    expect(parseGoCoord(" d4 ", 9)).toEqual({ x: 3, y: 5 });
    for (const bad of ["I5", "K1", "A10", "A0", "D", "44", "D4E", ""]) expect(parseGoCoord(bad, 9), bad).toBeNull();
    expect(parseGoCoord("T19", 19)).toEqual({ x: 18, y: 0 });
  });
});

describe("naming a colour", () => {
  it("knows a colour by name, by glyph or by bowl number — but only one that is seated", () => {
    expect(goColourOf("white", 2)).toBe(1);
    expect(goColourOf("X", 2)).toBe(0);
    expect(goColourOf("1", 2)).toBe(1);
    expect(goColourOf("Coral", 2)).toBeNull();
    expect(goColourOf("Coral", 3)).toBe(2);
    expect(goColourOf("mauve", 8)).toBeNull();
  });

  it("gives every colour its own glyph and name", () => {
    expect(new Set(GO_GLYPHS).size).toBe(GO_GLYPHS.length);
    expect(GO_NAMES).toHaveLength(GO_GLYPHS.length);
    expect(GO_GLYPHS).not.toContain("+");
    expect(GO_GLYPHS).not.toContain(".");
  });
});

describe("the board as text", () => {
  it("draws the grid with its coordinates, stones and star points", () => {
    const text = goBoardText(table({
      size: 5,
      stones: [{ x: 0, y: 4, colour: 0 }, { x: 4, y: 0, colour: 1 }],
      activeColour: 0,
    }));
    expect(text.split("\n").slice(0, 7)).toEqual([
      "  A B C D E",
      "5 . . . . O 5",
      "4 . . . . . 4",
      "3 . . + . . 3",
      "2 . . . . . 2",
      "1 X . . . . 1",
      "  A B C D E",
    ]);
  });

  it("says whose turn it is, the last move, captures and how many moves there are", () => {
    const text = goBoardText(table({
      size: 9,
      stones: [{ x: 3, y: 5, colour: 0 }, { x: 4, y: 4, colour: 1 }],
      captures: [{ x: 0, y: 0, colour: 0, by: 1 }],
      activeColour: 0,
      revision: 7,
    }));
    expect(text).toContain("revision 7");
    expect(text).toContain("last move: White E5");
    expect(text).toContain("White (O) captured 1");
    expect(text).toContain("to play: Black (X), 79 legal moves");
  });

  it("says when a stone is in somebody's hand instead of inviting a move", () => {
    const text = goBoardText(table({ liftedColour: 0, carrier: { by: "baiwei2", hand: "right" } }));
    expect(text).toContain("carried by baiwei2");
    expect(text).not.toContain("to play:");
  });

  it("lines the columns up on a board with two-digit rows", () => {
    const lines = goBoardText(table({ size: 19 })).split("\n");
    expect(lines[1].startsWith("19 ")).toBe(true);
    expect(lines[19].startsWith(" 1 ")).toBe(true);
    expect(lines[0].indexOf("A")).toBe(lines[1].indexOf(".", 2));
  });

  it("marks the same star points the table draws", () => {
    expect(goStarPoints(5)).toEqual([2]);
    expect(goStarPoints(9)).toEqual([2, 4, 6]);
    expect(goStarPoints(19)).toEqual([3, 9, 15]);
  });
});
