/**
 * What is covering what on a mood board, and where there is room.
 *
 * WHY THIS EXISTS. An agent placing an item on a mood board cannot see the
 * board. So it picks coordinates that sound considered — "the candle centred at
 * (650, 180)" — and lands on top of three photographs. That happened twice in
 * one evening to the same agent: Nikk first ("the text is on right in the
 * position of your last SVG image"), then again in the composition meant to fix
 * it, where eight items overlapped and the piece described as the quiet centre
 * was sitting across a Muybridge and a Marey.
 *
 * Neither time was carelessness. A person drags a card and sees the result; an
 * agent posts coordinates into the dark. The fix is not more care, it is a way
 * to look — so this computes what a pair of eyes would have noticed, and names
 * the first row that is actually empty.
 */

export type Placed = {
  /** Whatever identifies it to a person reading the output. */
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stacking order: the higher one is the one doing the covering. */
  z?: number;
};

export type Covering = {
  /** The item on top. */
  top: string;
  /** The item underneath it. */
  under: string;
  /** How much is hidden. */
  wide: number;
  tall: number;
};

/** Every pair that overlaps, worst first, with the one on top named first. */
export function coverings(items: Placed[]): Covering[] {
  const found: Covering[] = [];
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      const wide = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const tall = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (wide <= 0 || tall <= 0) continue;
      // Equal z is a draw; name them in the order given rather than inventing
      // a winner, because the renderer will not be consistent about it either.
      const [top, under] = (b.z ?? 0) > (a.z ?? 0) ? [b, a] : [a, b];
      found.push({ top: top.label, under: under.label, wide, tall });
    }
  }
  return found.sort((one, two) => two.wide * two.tall - one.wide * one.tall);
}

/**
 * The first y below everything already placed, with a gap.
 *
 * Deliberately not "the largest empty rectangle": a board is read in rows, and
 * an agent that cannot see it should be putting new things UNDER the existing
 * ones rather than threading them into gaps it cannot judge.
 */
export function freeRow(items: Placed[], gap = 40): number {
  let lowest = 0;
  for (const item of items) lowest = Math.max(lowest, item.y + item.h);
  return lowest === 0 ? gap : Math.round(lowest + gap);
}

/**
 * Places for `count` items in a row starting at `y`, left to right, wrapping
 * onto another row when the board's width runs out.
 */
export function rowPlaces(
  count: number,
  options: { y: number; size?: number; gap?: number; left?: number; width?: number },
): { x: number; y: number }[] {
  const size = options.size ?? 240;
  const gap = options.gap ?? 80;
  const left = options.left ?? 100;
  const width = options.width ?? 1800;
  const step = size + gap;
  const perRow = Math.max(1, Math.floor((width - left + gap) / step));
  return Array.from({ length: count }, (_, i) => ({
    x: left + (i % perRow) * step,
    y: options.y + Math.floor(i / perRow) * step,
  }));
}
