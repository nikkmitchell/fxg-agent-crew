import type { GoStone } from "./room-items.js";

const key = (x: number, y: number) => `${x},${y}`;
const neighbours = (x: number, y: number, size: number) =>
  [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([a, b]) => a >= 0 && b >= 0 && a < size && b < size);

/** Orthogonal groups only. Edges are boundaries; any other colour blocks. */
function groupAt(board: Map<string, GoStone>, start: GoStone, size: number) {
  const group = new Map<string, GoStone>();
  const todo = [start];
  let liberty = false;
  while (todo.length) {
    const stone = todo.pop()!;
    const id = key(stone.x, stone.y);
    if (group.has(id)) continue;
    group.set(id, stone);
    for (const [x, y] of neighbours(stone.x, stone.y, size)) {
      const next = board.get(key(x, y));
      if (!next) liberty = true;
      else if (next.colour === start.colour && !group.has(key(x, y))) todo.push(next);
    }
  }
  return { stones: [...group.values()], liberty };
}

/**
 * A point that may not be played on the very next move: simple ko.
 *
 * Nikk (4826): "right after you've captured ... the other person can capture
 * right back; in normal Go that is not allowed". When a single stone captures a
 * single stone and is left with that one point as its only liberty, playing
 * straight back there would recreate the position before. So that point is
 * closed for exactly one move; any other move, or a pass, opens it again.
 */
export type GoKo = { x: number; y: number } | null;

export type GoMove = { stones: GoStone[]; captured: GoStone[]; ko: GoKo } | { error: string };
export function placeGoStone(stones: GoStone[], size: number, placed: GoStone, ko: GoKo = null): GoMove {
  if (![placed.x, placed.y].every((n) => Number.isInteger(n) && n >= 0 && n < size)) return { error: "That intersection is outside the board." };
  const board = new Map(stones.map((s) => [key(s.x, s.y), s]));
  if (board.has(key(placed.x, placed.y))) return { error: "That intersection is occupied." };
  if (ko && ko.x === placed.x && ko.y === placed.y) return { error: "Ko: that retakes straight back. Play somewhere else first." };
  board.set(key(placed.x, placed.y), placed);
  const captured = new Map<string, GoStone>();
  // Evaluate before removal: simultaneous captures matter with 3+ colours.
  for (const [x, y] of neighbours(placed.x, placed.y, size)) {
    const enemy = board.get(key(x, y));
    if (!enemy || enemy.colour === placed.colour || captured.has(key(x, y))) continue;
    const group = groupAt(board, enemy, size);
    if (!group.liberty) for (const s of group.stones) captured.set(key(s.x, s.y), s);
  }
  for (const id of captured.keys()) board.delete(id);
  const own = groupAt(board, placed, size);
  if (!own.liberty) return { error: "That move leaves your group without a liberty." };
  // Ko: one stone took one stone and now has only that point to breathe from.
  let nextKo: GoKo = null;
  if (captured.size === 1 && own.stones.length === 1) {
    const [taken] = captured.values();
    const libs = neighbours(placed.x, placed.y, size).filter(([x, y]) => !board.has(key(x, y)));
    if (libs.length === 1 && libs[0][0] === taken.x && libs[0][1] === taken.y) nextKo = { x: taken.x, y: taken.y };
  }
  return { stones: [...board.values()], captured: [...captured.values()], ko: nextKo };
}

export function legalGoMoves(stones: GoStone[], size: number, colour: number, ko: GoKo = null): { x: number; y: number }[] {
  const moves = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!("error" in placeGoStone(stones, size, { x, y, colour }, ko))) moves.push({ x, y });
  }
  return moves;
}
