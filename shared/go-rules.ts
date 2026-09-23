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

export type GoMove = { stones: GoStone[]; captured: GoStone[] } | { error: string };
export function placeGoStone(stones: GoStone[], size: number, placed: GoStone): GoMove {
  if (![placed.x, placed.y].every((n) => Number.isInteger(n) && n >= 0 && n < size)) return { error: "That intersection is outside the board." };
  const board = new Map(stones.map((s) => [key(s.x, s.y), s]));
  if (board.has(key(placed.x, placed.y))) return { error: "That intersection is occupied." };
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
  if (!groupAt(board, placed, size).liberty) return { error: "That move leaves your group without a liberty." };
  return { stones: [...board.values()], captured: [...captured.values()] };
}

export function legalGoMoves(stones: GoStone[], size: number, colour: number): { x: number; y: number }[] {
  const moves = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!("error" in placeGoStone(stones, size, { x, y, colour }))) moves.push({ x, y });
  }
  return moves;
}
