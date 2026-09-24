import { describe, expect, it } from "vitest";
import { countGo, goLeaders } from "./go-score";
import type { GoStone } from "./room-items";

/** A board from rows of text: "." empty, digits are colours. Row 0 is y = 0. */
const board = (...rows: string[]): { stones: GoStone[]; size: number } => {
  const stones: GoStone[] = [];
  rows.forEach((row, y) => [...row].forEach((cell, x) => {
    if (cell !== ".") stones.push({ x, y, colour: Number(cell) });
  }));
  return { stones, size: rows.length };
};

describe("counting the board (area scoring)", () => {
  it("gives an empty board to nobody", () => {
    const { stones, size } = board(".....", ".....", ".....", ".....", ".....");
    const count = countGo(stones, size, 2);
    expect(count.territory).toEqual([]);
    expect(count.neutral).toHaveLength(25);
    expect(count.scores.map((s) => s.total)).toEqual([0, 0]);
  });

  it("gives an empty region to the one colour that surrounds it", () => {
    // Black walls off the left two columns; white the right two; the middle column is shared.
    const { stones, size } = board(
      "..0.1",
      "..0.1",
      "..0.1",
      "..0.1",
      "..0.1",
    );
    const count = countGo(stones, size, 2);
    const black = count.scores[0], white = count.scores[1];
    expect(black).toEqual({ colour: 0, stones: 5, territory: 10, total: 15 });
    // Column 3 touches black on its left and white on its right: nobody's.
    expect(white).toEqual({ colour: 1, stones: 5, territory: 0, total: 5 });
    expect(count.neutral).toHaveLength(5);
  });

  it("counts stones AND surrounded points, so a filled-in own point loses nothing", () => {
    const open = countGo(board("0.0", "000", "...").stones, 3, 2).scores[0].total;
    const filled = countGo(board("000", "000", "...").stones, 3, 2).scores[0].total;
    expect(filled).toBe(open);
  });

  /** Nikk: "figure out how you would do that for more than two players". */
  it("works the same for three colours, and a region touching two of them is nobody's", () => {
    const { stones, size } = board(
      ".0.1.",
      "00.11",
      ".....",
      "22222",
      ".....",
    );
    const count = countGo(stones, size, 3);
    // (0,0) is black's alone; (4,0) white's alone. The row y=2 and (2,0),(2,1)
    // touch black, white and red: nobody's. The bottom row is red's alone.
    expect(count.territory.filter((p) => p.colour === 0)).toEqual([{ x: 0, y: 0, colour: 0 }]);
    expect(count.territory.filter((p) => p.colour === 1)).toEqual([{ x: 4, y: 0, colour: 1 }]);
    expect(count.territory.filter((p) => p.colour === 2)).toHaveLength(5);
    expect(count.scores.map((s) => s.total), "3+1, 3+1, 5+5").toEqual([4, 4, 10]);
  });

  it("scores a seated colour with nothing on the board as zero, not missing", () => {
    const count = countGo(board("0..", "...", "...").stones, 3, 4);
    expect(count.scores).toHaveLength(4);
    expect(count.scores[3]).toEqual({ colour: 3, stones: 0, territory: 0, total: 0 });
  });

  it("every point is exactly one of: a stone, someone's territory, or neutral", () => {
    const { stones, size } = board(".0.1.", "00.11", ".....", "22222", ".....");
    const count = countGo(stones, size, 3);
    expect(stones.length + count.territory.length + count.neutral.length).toBe(size * size);
  });
});

describe("who is ahead", () => {
  it("names the leader, and says a tie is a tie", () => {
    const score = (colour: number, total: number) => ({ colour, stones: total, territory: 0, total });
    expect(goLeaders([score(0, 10), score(1, 12)])).toEqual([1]);
    expect(goLeaders([score(0, 12), score(1, 12), score(2, 3)])).toEqual([0, 1]);
  });
});
