import { Chess, type Square } from "chess.js";

export const TABLE_GAMES = [
  "chess",
  "checkers",
  "connect-four",
  "reversi",
  "tic-tac-toe",
] as const;
export type TableGame = (typeof TABLE_GAMES)[number];
export const GAME_NAMES: Record<TableGame, string> = {
  chess: "Chess",
  checkers: "Checkers",
  "connect-four": "Connect Four",
  reversi: "Reversi",
  "tic-tac-toe": "Tic-tac-toe",
};
export const isTableGame = (v: unknown): v is TableGame =>
  typeof v === "string" && (TABLE_GAMES as readonly string[]).includes(v);
export type GameMove = {
  from?: number;
  to?: number;
  column?: number;
  promotion?: string;
};
export type GameState = {
  board: number[];
  turn: 1 | 2;
  winner: 0 | 1 | 2 | null;
  forced: number | null;
  quiet: number;
  moves: string[];
  positions: string[];
};
export type GameRoomItem = {
  id: string;
  kind: "game";
  game: TableGame;
  revision: number;
  position: { x: number; y: number; z: number; rotationY: number };
  scale: number;
  state: GameState;
  seats: [string | null, string | null];
  resetBy: string[];
  addedBy: string;
};
export function gameWidth(game: TableGame) {
  return game === "tic-tac-toe" ? 3 : game === "connect-four" ? 7 : 8;
}
export function initialGame(game: TableGame): GameState {
  const board = Array(
    game === "connect-four" ? 42 : game === "tic-tac-toe" ? 9 : 64,
  ).fill(0);
  if (game === "checkers")
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8);
      if ((row + (i % 8)) % 2 === 1 && (row < 3 || row > 4))
        board[i] = row < 3 ? 2 : 1;
    }
  if (game === "reversi") {
    board[27] = 2;
    board[28] = 1;
    board[35] = 1;
    board[36] = 2;
  }
  return {
    board,
    turn: 1,
    winner: null,
    forced: null,
    quiet: 0,
    moves: [],
    positions: [JSON.stringify([board, 1, null])],
  };
}
export function defaultGameItem(
  id: string,
  game: TableGame,
  by: string,
  ordinal = 0,
): GameRoomItem {
  return {
    id,
    kind: "game",
    game,
    revision: 0,
    position: {
      x: (ordinal % 3) * 2.3 - 2.3,
      y: 0,
      z: 3.4 + Math.floor(ordinal / 3) * 2.3,
      rotationY: 0,
    },
    scale: 1,
    state: initialGame(game),
    seats: [null, null],
    resetBy: [],
    addedBy: by,
  };
}
export function parseGameItem(v: unknown): GameRoomItem | null {
  if (!v || typeof v !== "object") return null;
  const i = v as GameRoomItem;
  if (
    i.kind !== "game" ||
    typeof i.id !== "string" ||
    !isTableGame(i.game) ||
    !Number.isSafeInteger(i.revision) ||
    i.revision < 0 ||
    !i.position ||
    !Object.values(i.position).every(Number.isFinite) ||
    !Number.isFinite(i.scale) ||
    i.scale <= 0
  )
    return null;
  const s = i.state;
  if (
    !s ||
    !Array.isArray(s.board) ||
    s.board.length !== initialGame(i.game).board.length ||
    !s.board.every((n) => Number.isInteger(n) && Math.abs(n) <= 2) ||
    ![1, 2].includes(s.turn) ||
    ![null, 0, 1, 2].includes(s.winner) ||
    !Array.isArray(s.moves) ||
    !s.moves.every((m) => typeof m === "string") ||
    !Array.isArray(s.positions) ||
    !Array.isArray(i.seats) ||
    i.seats.length !== 2 ||
    !i.seats.every((n) => n === null || typeof n === "string") ||
    !Array.isArray(i.resetBy)
  )
    return null;
  return i;
}
export type LegalGameMove = {
  from?: number;
  to: number;
  promotion?: string;
  captures?: number[];
};
const other = (n: 1 | 2): 1 | 2 => (n === 1 ? 2 : 1);
const owner = (n: number) => (n === 0 ? 0 : Math.abs(n) === 1 ? 1 : 2);
const inBoard = (x: number, y: number) => x >= 0 && x < 8 && y >= 0 && y < 8;
const square = (i: number) =>
  ("abcdefgh"[i % 8] + (8 - Math.floor(i / 8))) as Square;
function chessOf(s: GameState) {
  const c = new Chess();
  for (const move of s.moves) c.move(move);
  return c;
}
export function chessInCheck(s: GameState) {
  return chessOf(s).isCheck();
}
export function chessBoard(s: GameState) {
  return chessOf(s)
    .board()
    .flat()
    .map((p) => (p ? { type: p.type, side: p.color === "w" ? 1 : 2 } : null));
}
export function legalGameMoves(game: TableGame, s: GameState): LegalGameMove[] {
  if (s.winner !== null) return [];
  if (game === "chess")
    return chessOf(s)
      .moves({ verbose: true })
      .map((m) => ({
        from: (8 - Number(m.from[1])) * 8 + "abcdefgh".indexOf(m.from[0]),
        to: (8 - Number(m.to[1])) * 8 + "abcdefgh".indexOf(m.to[0]),
        promotion: m.promotion,
      }));
  if (game === "connect-four")
    return Array.from({ length: 7 }, (_, x) => x)
      .filter((x) => !s.board[x])
      .map((x) => ({ to: x, column: x }));
  if (game === "tic-tac-toe")
    return s.board.flatMap((n, i) => (n ? [] : [{ to: i }]));
  if (game === "reversi") return reversiMoves(s.board, s.turn);
  const moves: LegalGameMove[] = [],
    jumps: LegalGameMove[] = [];
  for (let from = 0; from < 64; from++) {
    if (
      owner(s.board[from]) !== s.turn ||
      (s.forced !== null && s.forced !== from)
    )
      continue;
    const x = from % 8,
      y = Math.floor(from / 8),
      dirs = s.board[from] < 0 ? [-1, 1] : [s.turn === 1 ? -1 : 1];
    for (const dy of dirs)
      for (const dx of [-1, 1]) {
        const nx = x + dx,
          ny = y + dy;
        if (!inBoard(nx, ny)) continue;
        const near = ny * 8 + nx;
        if (!s.board[near] && s.forced === null) moves.push({ from, to: near });
        const tx = x + dx * 2,
          ty = y + dy * 2;
        if (
          s.board[near] &&
          owner(s.board[near]) !== s.turn &&
          inBoard(tx, ty) &&
          !s.board[ty * 8 + tx]
        )
          jumps.push({ from, to: ty * 8 + tx, captures: [near] });
      }
  }
  return jumps.length ? jumps : moves;
}
function reversiMoves(board: number[], turn: 1 | 2): LegalGameMove[] {
  const found: LegalGameMove[] = [];
  for (let to = 0; to < 64; to++) {
    if (board[to]) continue;
    const flips: number[] = [];
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1]) {
        if (!dx && !dy) continue;
        let x = (to % 8) + dx,
          y = Math.floor(to / 8) + dy;
        const line: number[] = [];
        while (inBoard(x, y) && board[y * 8 + x] === other(turn)) {
          line.push(y * 8 + x);
          x += dx;
          y += dy;
        }
        if (line.length && inBoard(x, y) && board[y * 8 + x] === turn)
          flips.push(...line);
      }
    if (flips.length) found.push({ to, captures: flips });
  }
  return found;
}
function aligned(
  board: number[],
  width: number,
  height: number,
  need: number,
  side: number,
) {
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (const [dx, dy] of [
        [1, 0],
        [0, 1],
        [1, 1],
        [-1, 1],
      ]) {
        let n = 0;
        while (n < need) {
          const a = x + dx * n,
            b = y + dy * n;
          if (
            a < 0 ||
            a >= width ||
            b < 0 ||
            b >= height ||
            board[b * width + a] !== side
          )
            break;
          n++;
        }
        if (n === need) return true;
      }
  return false;
}
export function applyGameMove(
  game: TableGame,
  source: GameState,
  move: GameMove,
): GameState | { error: string } {
  if (source.winner !== null)
    return { error: "This game is over. Start a new game to play again." };
  if (source.moves.length >= 2000)
    return { error: "Move limit reached. Start a new game." };
  const s: GameState = structuredClone(source),
    turn = s.turn;
  if (game === "chess") {
    if (
      !Number.isInteger(move.from) ||
      !Number.isInteger(move.to) ||
      move.from! < 0 ||
      move.from! > 63 ||
      move.to! < 0 ||
      move.to! > 63
    )
      return { error: "Choose a piece and a board square." };
    try {
      const c = chessOf(s),
        m = c.move({
          from: square(move.from!),
          to: square(move.to!),
          promotion: move.promotion ?? "q",
        });
      s.moves.push(m.san);
      s.turn = c.turn() === "w" ? 1 : 2;
      s.winner = c.isCheckmate() ? turn : c.isDraw() ? 0 : null;
      return s;
    } catch {
      return { error: "That chess move is not legal." };
    }
  }
  let to = game === "connect-four" ? (move.column ?? move.to) : move.to;
  if (!Number.isInteger(to)) return { error: "Choose a square or column." };
  const legal = legalGameMoves(game, s).find(
    (m) => m.to === to && (game !== "checkers" || m.from === move.from),
  );
  if (!legal)
    return {
      error:
        game === "checkers"
          ? "Choose a legal move. Captures are mandatory; finish the highlighted jump."
          : "That move is not legal.",
    };
  if (game === "connect-four") {
    let row = 5;
    while (row >= 0 && s.board[row * 7 + to!]) row--;
    to = row * 7 + to!;
  }
  if (game === "checkers") {
    const from = legal.from!,
      piece = s.board[from];
    s.board[from] = 0;
    s.board[to!] = piece;
    for (const cap of legal.captures ?? []) s.board[cap] = 0;
    const crowned = piece > 0 && (turn === 1 ? to! < 8 : to! >= 56);
    if (crowned) s.board[to!] = -piece;
    s.forced = legal.captures?.length && !crowned ? to! : null;
    s.quiet = legal.captures?.length || piece > 0 ? 0 : s.quiet + 1;
    if (s.quiet === 0) s.positions = [];
    if (
      s.forced !== null &&
      !legalGameMoves(game, s).some((m) => m.captures?.length)
    )
      s.forced = null;
    if (s.forced === null) s.turn = other(turn);
    if (
      s.forced === null &&
      !legalGameMoves(game, { ...s, forced: null, turn: other(turn) }).length
    )
      s.winner = turn;
    if (s.quiet >= 80) s.winner = 0;
  } else {
    s.board[to!] = turn;
    for (const cap of legal.captures ?? []) s.board[cap] = turn;
    s.turn = other(turn);
    if (game === "reversi") {
      if (!reversiMoves(s.board, s.turn).length) s.turn = turn;
      if (!reversiMoves(s.board, s.turn).length) {
        const a = s.board.filter((n) => n === 1).length,
          b = s.board.filter((n) => n === 2).length;
        s.winner = a === b ? 0 : a > b ? 1 : 2;
      }
    } else if (
      aligned(
        s.board,
        gameWidth(game),
        game === "connect-four" ? 6 : 3,
        game === "connect-four" ? 4 : 3,
        turn,
      )
    )
      s.winner = turn;
    else if (s.board.every(Boolean)) s.winner = 0;
  }
  s.moves.push(game === "checkers" ? `${legal.from}-${to}` : String(to));
  const key = JSON.stringify([s.board, s.turn, s.forced]);
  s.positions.push(key);
  if (game === "checkers" && s.positions.filter((p) => p === key).length >= 3)
    s.winner = 0;
  return s;
}
export function gameSide(game: TableGame, side: number) {
  return game === "reversi"
    ? side === 1
      ? "Black"
      : "White"
    : game === "connect-four"
      ? side === 1
        ? "Red"
        : "Gold"
      : game === "tic-tac-toe"
        ? side === 1
          ? "Crosses"
          : "Circles"
        : side === 1
          ? game === "checkers"
            ? "Red"
            : "White"
          : game === "checkers"
            ? "Ivory"
            : "Black";
}
export function gameInstruction(game: TableGame) {
  return {
    chess:
      "Choose a piece, then a lit square. Castling, en passant and promotion are supported.",
    checkers:
      "English draughts: Red starts. Captures are mandatory; finish every jump. Kings move one square diagonally.",
    "connect-four":
      "Choose a column to drop a disc. Make four in a row, across, up or diagonally.",
    reversi:
      "Black starts. Place a disc to enclose and flip a line. A player with no move is skipped. Most discs wins.",
    "tic-tac-toe": "Take turns placing a mark. Make three in a row.",
  }[game];
}

export function gameBoardText(item: GameRoomItem) {
  const width = gameWidth(item.game),
    symbols =
      item.game === "tic-tac-toe"
        ? ["X", "O"]
        : item.game === "reversi"
          ? ["B", "W"]
          : item.game === "connect-four"
            ? ["R", "Y"]
            : ["r", "i"];
  const cells =
    item.game === "chess"
      ? chessBoard(item.state).map((p) =>
          p ? (p.side === 1 ? p.type.toUpperCase() : p.type) : ".",
        )
      : item.state.board.map((n) =>
          n === 0
            ? "."
            : n < 0
              ? symbols[Math.abs(n) - 1].toUpperCase()
              : symbols[n - 1],
        );
  const rows = [];
  for (let y = 0; y < cells.length / width; y++)
    rows.push(
      `${cells.length / width - y}  ${cells.slice(y * width, (y + 1) * width).join(" ")}`,
    );
  return (
    rows.join("\n") +
    "\n   " +
    Array.from({ length: width }, (_, i) => "abcdefgh"[i]).join(" ")
  );
}
