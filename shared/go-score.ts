import type { GoStone } from "./room-items.js";

/**
 * Who owns the board, for any number of players.
 *
 * Nikk (4504): "we also need a way for calculating the land owned, so once
 * everybody's passed then the land owned shows up ... figure out how you would
 * do that for more than two players, so if there's extra colours as well".
 *
 * AREA SCORING (the Chinese count), because it is the one that extends to more
 * than two players without inventing rules: a colour's score is its stones on
 * the board plus the empty points only it surrounds.
 *
 * An empty region — the empty points connected to each other, up, down, left
 * and right — belongs to a colour when every stone touching its edge is that
 * colour. A region touching two or more colours belongs to nobody (in Go, dame;
 * neutral). A region touching no stones at all, which only an empty board has,
 * belongs to nobody either.
 *
 * NO DEAD-STONE AGREEMENT. A stone left on the board is counted as alive. In
 * area scoring that is fair: capturing a dead stone inside your own territory
 * before you pass costs you nothing, because the points you fill are still
 * yours. So "capture it, then pass" replaces a negotiation the room has no way
 * to hold between three people in headsets.
 */
export type GoPoint = { x: number; y: number };
export type GoScore = { colour: number; stones: number; territory: number; total: number };
export type GoCount = {
  /** Every owned empty point, and whose it is. */
  territory: (GoPoint & { colour: number })[];
  /** Empty points nobody owns. */
  neutral: GoPoint[];
  /** One per seated colour, in colour order. */
  scores: GoScore[];
};

export function countGo(stones: GoStone[], size: number, players: number): GoCount {
  const at = new Map<string, number>();
  for (const stone of stones) at.set(`${stone.x},${stone.y}`, stone.colour);
  const seen = new Set<string>();
  const territory: GoCount["territory"] = [];
  const neutral: GoPoint[] = [];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const key = `${x},${y}`;
      if (at.has(key) || seen.has(key)) continue;

      // One empty region, and every colour that touches its edge.
      const region: GoPoint[] = [];
      const touching = new Set<number>();
      const stack: GoPoint[] = [{ x, y }];
      seen.add(key);
      while (stack.length) {
        const point = stack.pop()!;
        region.push(point);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = point.x + dx, ny = point.y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const next = `${nx},${ny}`;
          const colour = at.get(next);
          if (colour !== undefined) touching.add(colour);
          else if (!seen.has(next)) {
            seen.add(next);
            stack.push({ x: nx, y: ny });
          }
        }
      }

      if (touching.size === 1) {
        const [owner] = touching;
        for (const point of region) territory.push({ ...point, colour: owner });
      } else {
        neutral.push(...region);
      }
    }
  }

  const scores: GoScore[] = Array.from({ length: players }, (_, colour) => {
    const own = stones.filter((stone) => stone.colour === colour).length;
    const land = territory.filter((point) => point.colour === colour).length;
    return { colour, stones: own, territory: land, total: own + land };
  });
  return { territory, neutral, scores };
}

/**
 * Who is ahead, or level. More than one colour when they are tied at the top:
 * a draw is said as a draw, not as whichever colour happened to be first.
 */
export function goLeaders(scores: GoScore[]): number[] {
  const best = Math.max(...scores.map((score) => score.total));
  return scores.filter((score) => score.total === best).map((score) => score.colour);
}
