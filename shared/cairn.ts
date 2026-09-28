/**
 * THE CAIRN: a stack of balanced stones that the room builds together, one
 * stone at a time, over days. Take a stone from the pile beside it and it goes
 * on top, settling with a little tilt and offset of its own; take the top one
 * off to put it back. Each stone is placed by somebody, and stays.
 */

export const MOST_STONES = 16;

export type CairnStone = { size: number; turn: number; dx: number; dz: number; tone: number; by: string };
export type Cairn = { stones: CairnStone[]; revision: number };
export type CairnChange = { action: "add"; seed: unknown } | { action: "lift" };
export type CairnEvent = { kind: "add"; stone: CairnStone; revision: number } | { kind: "lift"; revision: number };

export function emptyCairn(): Cairn {
  return { stones: [], revision: 0 };
}

/** A stone from a seed 0..1: smaller the higher it goes, so the cairn tapers. */
export function stoneFrom(seed: number, height: number, by: string): CairnStone {
  const r = (n: number) => {
    const s = Math.sin(seed * 9301 + n * 49297) * 233280;
    return s - Math.floor(s);
  };
  const taper = Math.max(0.45, 1 - height * 0.04);
  return {
    size: Math.round((0.07 + r(1) * 0.03) * taper * 1000) / 1000,
    turn: Math.round(r(2) * 6.28 * 100) / 100,
    dx: Math.round((r(3) - 0.5) * 0.02 * 1000) / 1000,
    dz: Math.round((r(4) - 0.5) * 0.02 * 1000) / 1000,
    tone: Math.floor(r(5) * 4),
    by,
  };
}

export function applyCairn(cairn: Cairn, change: CairnChange, by: string): { cairn: Cairn; event: CairnEvent } | { refused: string } {
  const revision = cairn.revision + 1;
  if (change.action === "lift") {
    if (!cairn.stones.length) return { refused: "There is no stone to lift." };
    return { cairn: { stones: cairn.stones.slice(0, -1), revision }, event: { kind: "lift", revision } };
  }
  if (cairn.stones.length >= MOST_STONES) return { refused: "The cairn is as tall as it can stand." };
  const seed = typeof change.seed === "number" && Number.isFinite(change.seed) ? change.seed : Math.random();
  const stone = stoneFrom(seed, cairn.stones.length, by);
  return { cairn: { stones: [...cairn.stones, stone], revision }, event: { kind: "add", stone, revision } };
}

export function applyCairnEvent(cairn: Cairn, event: CairnEvent): Cairn | null {
  if (event.revision <= cairn.revision) return cairn;
  if (event.revision !== cairn.revision + 1) return null;
  if (event.kind === "lift") return { stones: cairn.stones.slice(0, -1), revision: event.revision };
  return { stones: [...cairn.stones, event.stone], revision: event.revision };
}

export function parseCairn(value: unknown): Cairn | null {
  if (!value || typeof value !== "object") return null;
  const cairn = value as Partial<Cairn>;
  return Array.isArray(cairn.stones) && typeof cairn.revision === "number" ? { stones: cairn.stones, revision: cairn.revision } : null;
}

/** How high each stone sits: each rests on the one below, a little flattened. */
export function stoneHeights(stones: readonly CairnStone[]): number[] {
  const heights: number[] = [];
  let y = 0;
  for (const stone of stones) {
    y += stone.size * 0.55;
    heights.push(y);
    y += stone.size * 0.55;
  }
  return heights;
}
