import { describe, it, expect } from "vitest";
import {
  initialGame,
  applyGameMove,
  legalGameMoves,
  defaultGameItem,
  parseGameItem,
  type GameState,
  type TableGame,
} from "./table-games";
function play(
  g: TableGame,
  s: GameState,
  m: Parameters<typeof applyGameMove>[2],
) {
  const r = applyGameMove(g, s, m);
  if ("error" in r) throw Error(r.error);
  return r;
}
describe("tabletop rules", () => {
  it("checks chess turns, fool’s mate, and leaves an illegal move unchanged", () => {
    let s = initialGame("chess");
    const before = structuredClone(s);
    expect(applyGameMove("chess", s, { from: 52, to: 20 })).toHaveProperty(
      "error",
    );
    expect(s).toEqual(before);
    for (const [from, to] of [
      [53, 45],
      [12, 28],
      [54, 38],
      [3, 39],
    ])
      s = play("chess", s, { from, to });
    expect(s.winner).toBe(2);
    expect(legalGameMoves("chess", s)).toHaveLength(0);
  });
  it("detects a third repeated chess position from the full move history", () => {
    let s = initialGame("chess");
    for (let i = 0; i < 2; i++)
      for (const [from, to] of [
        [62, 45],
        [6, 21],
        [45, 62],
        [21, 6],
      ])
        s = play("chess", s, { from, to });
    expect(s.winner).toBe(0);
  });
  it("casts kings only after clearing their path and includes promotion choices", () => {
    let s = initialGame("chess");
    for (const [from, to] of [
      [52, 36],
      [12, 28],
      [62, 45],
      [1, 18],
      [61, 34],
      [6, 21],
    ])
      s = play("chess", s, { from, to });
    expect(legalGameMoves("chess", s)).toContainEqual(
      expect.objectContaining({ from: 60, to: 62 }),
    );
    s = play("chess", s, { from: 60, to: 62 });
    expect(s.moves.at(-1)).toBe("O-O");
  });
  it("allows en passant and every underpromotion option", () => {
    let s = initialGame("chess");
    for (const [from, to] of [
      [52, 36],
      [8, 16],
      [36, 28],
      [11, 27],
    ])
      s = play("chess", s, { from, to });
    s = play("chess", s, { from: 28, to: 19 });
    expect(s.moves.at(-1)).toBe("exd6");
    s = initialGame("chess");
    for (const [from, to] of [
      [48, 32],
      [15, 31],
      [32, 24],
      [31, 39],
      [24, 16],
      [39, 47],
      [16, 9],
      [47, 54],
    ])
      s = play("chess", s, { from, to });
    expect(
      legalGameMoves("chess", s)
        .filter((m) => m.from === 9 && m.to === 0)
        .map((m) => m.promotion)
        .sort(),
    ).toEqual(["b", "n", "q", "r"]);
    s = play("chess", s, { from: 9, to: 0, promotion: "n" });
    expect(s.moves.at(-1)).toMatch(/=N/);
  });
  it("drops Connect Four discs, refuses a full column, and detects all winning lines", () => {
    let s = initialGame("connect-four");
    for (const column of [0, 1, 0, 1, 0, 1, 0])
      s = play("connect-four", s, { column });
    expect(s.winner).toBe(1);
    expect(s.board[35]).toBe(1);
    s = initialGame("connect-four");
    for (let i = 0; i < 6; i++) s = play("connect-four", s, { column: 3 });
    expect(applyGameMove("connect-four", s, { column: 3 })).toHaveProperty(
      "error",
    );
    for (const cells of [
      [35, 36, 37],
      [35, 29, 23],
      [14, 22, 30],
    ]) {
      s = initialGame("connect-four");
      for (const i of cells) s.board[i] = 1;
      const to = cells[2] + (cells[2] - cells[1]);
      for (let i = to + 7; i < 42; i += 7) s.board[i] = 2;
      s = play("connect-four", s, { column: to % 7 });
      expect(s.winner).toBe(1);
    }
  });
  it("enforces mandatory checkers captures and an uninterrupted multiple jump", () => {
    let s = initialGame("checkers");
    s.board.fill(0);
    s.board[42] = 1;
    s.board[35] = 2;
    s.board[21] = 2;
    s.board[7] = 2;
    expect(legalGameMoves("checkers", s)).toEqual([
      { from: 42, to: 28, captures: [35] },
    ]);
    s = play("checkers", s, { from: 42, to: 28 });
    expect(s.turn).toBe(1);
    expect(s.forced).toBe(28);
    expect(applyGameMove("checkers", s, { from: 28, to: 19 })).toHaveProperty(
      "error",
    );
    s = play("checkers", s, { from: 28, to: 14 });
    expect(s.board[21]).toBe(0);
    expect(s.turn).toBe(2);
  });
  it("draws repeated king positions without waiting for the move cap", () => {
    let s = initialGame("checkers");
    s.board.fill(0);
    s.board[56] = -1;
    s.board[7] = -2;
    s.positions = [JSON.stringify([s.board, s.turn, null])];
    for (let i = 0; i < 2; i++)
      for (const [from, to] of [
        [56, 49],
        [7, 14],
        [49, 56],
        [14, 7],
      ])
        s = play("checkers", s, { from, to });
    expect(s.winner).toBe(0);
  });
  it("crowns a checker and ends the capture turn on the crown row", () => {
    let s = initialGame("checkers");
    s.board.fill(0);
    s.board[17] = 1;
    s.board[10] = 2;
    s.board[12] = 2;
    s = play("checkers", s, { from: 17, to: 3 });
    expect(s.board[3]).toBe(-1);
    expect(s.forced).toBeNull();
    expect(s.turn).toBe(2);
  });
  it("flips Reversi lines and skips a player with no move, finishing by disc count", () => {
    let s = initialGame("reversi");
    expect(legalGameMoves("reversi", s).map((m) => m.to)).toEqual([
      19, 26, 37, 44,
    ]);
    s = play("reversi", s, { to: 19 });
    expect(s.board[27]).toBe(1);
    expect(s.turn).toBe(2);
    s = initialGame("reversi");
    s.board.fill(1);
    s.board[0] = 0;
    s.board[1] = 2;
    s.board[6] = 2;
    s.board[7] = 0;
    s = play("reversi", s, { to: 0 });
    expect(s.turn).toBe(1);
    expect(s.winner).toBeNull();
    s = play("reversi", s, { to: 7 });
    expect(s.winner).toBe(1);
  });
  it("ends tic-tac-toe wins and draws and rejects later moves", () => {
    let s = initialGame("tic-tac-toe");
    for (const to of [0, 3, 1, 4, 2]) s = play("tic-tac-toe", s, { to });
    expect(s.winner).toBe(1);
    expect(applyGameMove("tic-tac-toe", s, { to: 5 })).toHaveProperty("error");
    s = initialGame("tic-tac-toe");
    for (const to of [0, 1, 2, 4, 3, 5, 7, 6, 8])
      s = play("tic-tac-toe", s, { to });
    expect(s.winner).toBe(0);
  });
  it("places the first table ahead and later rows away from the arriving viewer", () => {
    const first = defaultGameItem("first", "chess", "Skein");
    expect(first.position.x).toBe(0);
    expect(first.position.z).toBeLessThan(4);
    for (let i = 1; i < 9; i++)
      expect(
        defaultGameItem(String(i), "chess", "Skein", i).position.z,
      ).toBeLessThan(first.position.z);
  });
  it("round-trips a persisted table and rejects malformed stored grids", () => {
    const i = defaultGameItem("g", "checkers", "Skein");
    expect(parseGameItem(JSON.parse(JSON.stringify(i)))).toEqual(i);
    i.state.board = [];
    expect(parseGameItem(i)).toBeNull();
  });
});

describe("a saved chess history", () => {
  it("is refused when it does not replay, however often it is read, and taken when it does", () => {
    const good = defaultGameItem("t", "chess", "Alice");
    good.state = { ...good.state, moves: ["e4", "e5", "Nf3"] };
    const bad = defaultGameItem("t", "chess", "Alice");
    bad.state = { ...bad.state, moves: ["e4", "e4"] };
    for (let i = 0; i < 3; i += 1) {
      expect(parseGameItem(JSON.parse(JSON.stringify(bad))), "read " + i).toBeNull();
      expect(parseGameItem(JSON.parse(JSON.stringify(good))), "read " + i).not.toBeNull();
    }
  });

  it("is never mistaken for another history that would read the same if joined (Skein)", () => {
    const withMoves = (moves: string[]) => {
      const item = defaultGameItem("t", "chess", "Alice");
      item.state = { ...item.state, moves };
      return JSON.parse(JSON.stringify(item));
    };
    expect(parseGameItem(withMoves([]))).not.toBeNull();
    expect(parseGameItem(withMoves([""]))).toBeNull();
    expect(parseGameItem(withMoves(["e4", "e5"]))).not.toBeNull();
    expect(parseGameItem(withMoves(["e4 e5"]))).toBeNull();
  });
});
