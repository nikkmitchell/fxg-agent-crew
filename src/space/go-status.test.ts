import { describe, expect, it } from "vitest";
import { defaultGoItem, type GoRoomItem } from "../../shared/room-items";
import { canPass, clockLine, lastPassLine, noMoveLine, passLabel, resultRows, scoreLine, turnLine, winners } from "./go-status";

const table = (over: Partial<GoRoomItem> = {}): GoRoomItem => ({ ...defaultGoItem("t"), size: 5, ...over });
const T = 1_000_000;

describe("the line in front of the board", () => {
  it("says whose turn it is", () => {
    expect(turnLine(table())).toBe("BLACK'S TURN");
  });

  /** Short, so it never runs into SETTINGS and MOVE either side of it. */
  it("stays short after a pass; who passed goes on the line below", () => {
    expect(turnLine(table({ activeColour: 1, passes: 1 }))).toBe("WHITE'S TURN");
    expect(lastPassLine(table({ activeColour: 1, passes: 1, colours: ["a", "b", "c"] })))
      .toBe("BLACK passed (1 in a row; the game ends when all 3 pass)");
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

  /** Baiwei: "should be arranged more neatly" — rows, not one long line. */
  it("once it is over, gives the result as rows: winner, each count highest first, how to start again", () => {
    expect(scoreLine(table({ stones, ended: true })), "the rows say it instead").toBeNull();
    expect(resultRows(table({ stones: stones.map((s) => ({ ...s, colour: 1 - s.colour })), ended: true }))).toEqual({
      verdict: "WHITE WINS",
      scores: [{ colour: 1, text: "WHITE 15" }, { colour: 0, text: "BLACK 5" }],
      again: "Clear the stones in settings for a new game",
    });
  });

  it("says a tie is a tie, and highlights every colour that tied", () => {
    expect(resultRows(table({ ended: true }))?.verdict).toBe("A TIE");
    expect(winners(table({ ended: true }))).toEqual([0, 1]);
    expect(winners(table({ stones, ended: true }))).toEqual([0]);
    expect(winners(table({ stones })), "nobody has won a game still going").toEqual([]);
  });
});

/** Baiwei: "I cannot make a move. Is it assigned to someone?" */
describe("when the player to move has no legal move", () => {
  // A 5x5 all White but two separate one-point eyes. Black in either eye has
  // no liberty and captures nothing (White keeps the other eye), so it is
  // suicide both times: Black has no legal move. (A ring with ONE eye would not
  // do: Black in it takes the ring's last liberty and captures it.)
  const eyes = new Set(["1,1", "3,3"]);
  const white = Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), colour: 1 }))
    .filter((stone) => !eyes.has(`${stone.x},${stone.y}`));

  it("tells them to pass", () => {
    expect(noMoveLine(table())).toBeNull();
    expect(noMoveLine(table({ stones: white }))).toBe("No legal move for BLACK: press PASS at the glowing bowl");
  });

  it("says nothing once the game is over", () => {
    expect(noMoveLine(table({ stones: white, ended: true }))).toBeNull();
  });
});

describe("passing, made obvious", () => {
  const stone = [{ x: 0, y: 0, colour: 0 }];

  it("offers PASS only once a stone has been played, and never with one in the air or after the end", () => {
    expect(canPass(table()), "an empty board has no game to pass in").toBe(false);
    expect(canPass(table({ stones: stone }))).toBe(true);
    expect(canPass(table({ stones: stone, liftedColour: 0 }))).toBe(false);
    expect(canPass(table({ stones: stone, ended: true }))).toBe(false);
  });

  it("says on the button when this pass ends the game", () => {
    expect(passLabel(table({ passes: 0 }))).toBe("PASS");
    expect(passLabel(table({ passes: 1 }))).toBe("PASS · ENDS GAME");
    expect(passLabel(table({ passes: 1, colours: ["a", "b", "c"] })), "one of three is not the last").toBe("PASS");
  });

  it("says on the table that one more pass ends it", () => {
    expect(lastPassLine(table({ passes: 1, activeColour: 1 }))).toBe("BLACK passed: one more pass ends the game");
    expect(lastPassLine(table())).toBeNull();
  });
});

/** Nikk (4826): a timer, shown on the table. */
describe("the clock line", () => {
  const clock = { perMove: 10, bank: [60, 60], turnStartedAt: T };
  it("says nothing on an untimed table", () => {
    expect(clockLine(table(), T)).toBeNull();
  });
  it("counts the free seconds, then the bank", () => {
    expect(clockLine(table({ clock }), T + 4_000)).toBe("⏱ 0:06 this move · extra 1:00");
    expect(clockLine(table({ clock }), T + 25_000)).toBe("⏱ extra time 0:45");
  });
  it("says who ran out, and a lost-on-time game names the loser and the winner", () => {
    expect(clockLine(table({ clock: { ...clock, bank: [0, 60] } }), T + 11_000)).toBe("BLACK IS OUT OF TIME");
    expect(winners(table({ ended: true, timedOut: 0 }))).toEqual([1]);
    expect(resultRows(table({ ended: true, timedOut: 0 }))?.verdict).toBe("BLACK OUT OF TIME · WHITE WINS");
  });
});
