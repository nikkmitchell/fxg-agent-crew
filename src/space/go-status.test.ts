import { describe, expect, it } from "vitest";
import { defaultGoItem, type GoRoomItem } from "../../shared/room-items";
import { scoreLine, turnLine } from "./go-status";

const table = (over: Partial<GoRoomItem> = {}): GoRoomItem => ({ ...defaultGoItem("t"), size: 5, ...over });

describe("the line in front of the board", () => {
  it("says whose turn it is", () => {
    expect(turnLine(table())).toBe("BLACK'S TURN");
  });

  /** So the next player knows one more pass ends a two-player game. */
  it("says who just passed", () => {
    expect(turnLine(table({ activeColour: 1, passes: 1 }))).toBe("WHITE'S TURN · BLACK PASSED");
  });

  it("says the game is over once everybody has passed", () => {
    expect(turnLine(table({ ended: true, passes: 2 }))).toBe("GAME OVER");
  });
});

describe("the count, in words", () => {
  // Black owns the left two columns; white the right one; the middle is shared.
  const stones = [0, 1, 2, 3, 4].flatMap((y) => [{ x: 2, y, colour: 0 }, { x: 4, y, colour: 1 }]);

  it("says nothing during play unless LAND is on", () => {
    expect(scoreLine(table({ stones }))).toBeNull();
  });

  it("calls a live count provisional, because it is not a verdict", () => {
    expect(scoreLine(table({ stones, territoryShown: true }))).toBe("LAND SO FAR (provisional): BLACK 15 · WHITE 5");
  });

  it("names the winner and how to start again once it is over", () => {
    expect(scoreLine(table({ stones, ended: true }))).toBe("BLACK WINS · BLACK 15 · WHITE 5 · clear the stones for a new game");
  });

  it("says a tie is a tie", () => {
    expect(scoreLine(table({ ended: true }))).toMatch(/^A TIE · BLACK 0 · WHITE 0/);
  });
});
