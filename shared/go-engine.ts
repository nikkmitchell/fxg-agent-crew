import type { GoPlayCard, GoRoomItem, GoScore, GoStone, GoStyle } from "./room-items.js";

export type GoMove = { x: number; y: number };
export type GoMoveResult =
  | { ok: true; stones: GoStone[]; captured: number; previousPosition: string; consecutivePasses: 0; gameOver: false }
  | { ok: false; reason: "occupied" | "suicide" | "ko" | "finished" };

const pointKey = (x: number, y: number) => `${x},${y}`;

export function positionKey(size: number, stones: readonly GoStone[]): string {
  const cells = Array.from({ length: size * size }, () => ".");
  for (const stone of stones) cells[stone.y * size + stone.x] = String.fromCharCode(65 + stone.colour);
  return cells.join("");
}

/**
 * Lightweight area scoring for a finished test game: stones plus empty regions
 * bordered by exactly one color. It intentionally does not adjudicate dead
 * groups; all stones still on the board count as alive. Two-color Go gives
 * white 6.5 komi, while multi-color house games have no komi.
 */
export function scoreGoArea(item: Pick<GoRoomItem, "size" | "stones" | "colours">): GoScore {
  const board = new Map(item.stones.map((stone) => [pointKey(stone.x, stone.y), stone.colour]));
  const area = item.colours.map(() => 0);
  const visited = new Set<string>();
  for (const stone of item.stones) area[stone.colour] += 1;

  for (let y = 0; y < item.size; y += 1) for (let x = 0; x < item.size; x += 1) {
    const startKey = pointKey(x, y);
    if (board.has(startKey) || visited.has(startKey)) continue;
    const region: GoMove[] = [];
    const borderColours = new Set<number>();
    const pending = [{ x, y }];
    while (pending.length) {
      const point = pending.pop()!;
      const key = pointKey(point.x, point.y);
      if (visited.has(key) || board.has(key)) continue;
      visited.add(key);
      region.push(point);
      for (const [nx, ny] of [[point.x - 1, point.y], [point.x + 1, point.y], [point.x, point.y - 1], [point.x, point.y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= item.size || ny >= item.size) continue;
        const neighbour = pointKey(nx, ny);
        const colour = board.get(neighbour);
        if (colour === undefined) {
          if (!visited.has(neighbour)) pending.push({ x: nx, y: ny });
        } else borderColours.add(colour);
      }
    }
    if (borderColours.size === 1) area[borderColours.values().next().value!] += region.length;
  }

  const komi = item.colours.map((_, index) => item.colours.length === 2 && index === 1 ? 6.5 : 0);
  const totals = area.map((points, index) => points + komi[index]);
  const highest = Math.max(...totals);
  const leaders = totals.flatMap((total, index) => total === highest ? [index] : []);
  return { area, komi, totals, winner: leaders.length === 1 ? leaders[0] : null };
}

function groupAt(size: number, board: Map<string, number>, start: GoMove) {
  const colour = board.get(pointKey(start.x, start.y));
  if (colour === undefined) return { stones: [] as GoMove[], liberties: new Set<string>() };
  const stones: GoMove[] = [];
  const liberties = new Set<string>();
  const seen = new Set<string>();
  const pending = [start];
  while (pending.length) {
    const point = pending.pop()!;
    const key = pointKey(point.x, point.y);
    if (seen.has(key)) continue;
    seen.add(key);
    stones.push(point);
    for (const [x, y] of [[point.x - 1, point.y], [point.x + 1, point.y], [point.x, point.y - 1], [point.x, point.y + 1]]) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const adjacent = pointKey(x, y);
      const occupant = board.get(adjacent);
      if (occupant === undefined) liberties.add(adjacent);
      else if (occupant === colour && !seen.has(adjacent)) pending.push({ x, y });
    }
  }
  return { stones, liberties };
}

/** Apply one legal placement under positional simple-ko rules. No tree search. */
export function applyGoMove(item: Pick<GoRoomItem, "size" | "stones" | "previousPosition" | "gameOver">, colour: number, move: GoMove): GoMoveResult {
  if (item.gameOver) return { ok: false, reason: "finished" };
  const board = new Map(item.stones.map((stone) => [pointKey(stone.x, stone.y), stone.colour]));
  const target = pointKey(move.x, move.y);
  if (board.has(target)) return { ok: false, reason: "occupied" };
  board.set(target, colour);

  let captured = 0;
  const removed = new Set<string>();
  for (const [x, y] of [[move.x - 1, move.y], [move.x + 1, move.y], [move.x, move.y - 1], [move.x, move.y + 1]]) {
    if (x < 0 || y < 0 || x >= item.size || y >= item.size) continue;
    const key = pointKey(x, y);
    const neighbour = board.get(key);
    if (neighbour === undefined || neighbour === colour || removed.has(key)) continue;
    const group = groupAt(item.size, board, { x, y });
    if (group.liberties.size === 0) {
      for (const stone of group.stones) {
        const removedKey = pointKey(stone.x, stone.y);
        board.delete(removedKey);
        removed.add(removedKey);
        captured += 1;
      }
    }
  }

  if (groupAt(item.size, board, move).liberties.size === 0) return { ok: false, reason: "suicide" };
  const stones = [...board.entries()].map(([key, stoneColour]) => {
    const [x, y] = key.split(",").map(Number);
    return { x, y, colour: stoneColour };
  });
  const resultingKey = positionKey(item.size, stones);
  if (item.previousPosition !== null && resultingKey === item.previousPosition) return { ok: false, reason: "ko" };
  return {
    ok: true,
    stones,
    captured,
    previousPosition: positionKey(item.size, item.stones),
    consecutivePasses: 0,
    gameOver: false,
  };
}

export type GoSuggestion = { x: number; y: number; reason: string; style: Exclude<GoStyle, "observer"> };

/**
 * Score every legal intersection once. This deliberately stays shallow and
 * bounded (at most 625 candidates on the supported 25×25 board); profile
 * weights alter the move itself instead of merely changing its narration.
 */
export function suggestGoMove(item: GoRoomItem, colour: number, card: GoPlayCard, actorId: string): GoSuggestion | null {
  const { style, risk } = card;
  if (style === "observer" || item.gameOver) return null;
  let best: { move: GoMove; score: number; reason: string; tie: number } | null = null;
  const occupied = new Set(item.stones.map((stone) => pointKey(stone.x, stone.y)));
  const friendly = item.stones.filter((stone) => stone.colour === colour);
  const opponents = item.stones.filter((stone) => stone.colour !== colour);
  const candidates: Array<{ move: GoMove; result: Extract<GoMoveResult, { ok: true }>; friendlyAdj: number; enemyAdj: number; edge: number; nearest: number }> = [];
  for (let y = 0; y < item.size; y += 1) for (let x = 0; x < item.size; x += 1) {
    if (occupied.has(pointKey(x, y))) continue;
    const result = applyGoMove(item, colour, { x, y });
    if (!result.ok) continue;
    const friendlyAdj = friendly.filter((stone) => Math.abs(stone.x - x) + Math.abs(stone.y - y) === 1).length;
    const enemyAdj = opponents.filter((stone) => Math.abs(stone.x - x) + Math.abs(stone.y - y) === 1).length;
    const edge = Math.min(x, y, item.size - 1 - x, item.size - 1 - y);
    const nearest = friendly.length ? Math.min(...friendly.map((stone) => Math.abs(stone.x - x) + Math.abs(stone.y - y))) : item.size;
    candidates.push({ move: { x, y }, result, friendlyAdj, enemyAdj, edge, nearest });
  }
  if (!candidates.length) return null;

  for (const candidate of candidates) {
    const post = { ...item, stones: candidate.result.stones, previousPosition: candidate.result.previousPosition };
    const liberties = groupAt(item.size, new Map(post.stones.map((stone) => [pointKey(stone.x, stone.y), stone.colour])), candidate.move).liberties.size;
    const centerDistance = Math.abs(candidate.move.x - (item.size - 1) / 2) + Math.abs(candidate.move.y - (item.size - 1) / 2);
    let score: number;
    let reason: string;
    switch (style) {
      case "patient":
        score = candidate.friendlyAdj * 3 + Math.min(liberties, 4) * (risk === "cautious" ? 2 : 1.5) + candidate.result.captured * (risk === "bold" ? 3 : 2) - candidate.enemyAdj * (risk === "bold" ? 0.3 : 0.8) - centerDistance * 0.18;
        reason = candidate.friendlyAdj ? "connects with your stones and keeps room to breathe" : "builds a calm, spacious shape";
        break;
      case "tactical":
        score = candidate.result.captured * (risk === "bold" ? 10 : 8) + candidate.enemyAdj * (risk === "bold" ? 3.2 : 2.4) + Math.min(liberties, 4) * (risk === "cautious" ? 1 : 0.45) - centerDistance * 0.08;
        reason = candidate.result.captured ? `captures ${candidate.result.captured} stone${candidate.result.captured === 1 ? "" : "s"}` : "leans into nearby contact and tactical pressure";
        break;
      case "experimental":
        score = candidate.nearest * (risk === "bold" ? 1.6 : 1.2) + (item.size - candidate.edge) * (risk === "bold" ? 0.8 : 0.35) + centerDistance * (risk === "bold" ? 0.9 : 0.25) + candidate.enemyAdj * (risk === "cautious" ? -0.3 : 0.3) + candidate.result.captured * 0.2;
        reason = "chooses a less expected point to explore a different shape";
        break;
      case "casual":
        score = Math.min(liberties, 4) * (risk === "cautious" ? 1.6 : 1.2) + candidate.friendlyAdj * 0.5 - candidate.enemyAdj * (risk === "bold" ? 0.3 : 1.1) - candidate.result.captured * 0.15;
        reason = "keeps the move simple and low-pressure";
        break;
    }
    const tie = stableTie(`${actorId}:${item.moveNumber}:${candidate.move.x}:${candidate.move.y}`);
    if (!best || score > best.score || (score === best.score && tie < best.tie)) best = { move: candidate.move, score, reason, tie };
  }
  return best ? { ...best.move, reason: best.reason, style } : null;
}

function stableTie(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}
