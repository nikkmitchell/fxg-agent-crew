import type { Ink } from "./card-paint.js";
import { CARD_INK, fitLines } from "./card-paint.js";

/**
 * A titled list, drawn on a panel.
 *
 * TWO PANELS SHARE THIS: who is in the room, and what has been said in it.
 * Both are "a heading and a column of short entries", and writing that twice
 * is how two panels end up looking like two different products.
 *
 * THE TAIL, NOT THE HEAD, for anything that grows. A panel cannot scroll, so a
 * transcript that drew from the beginning would show the start of a
 * conversation forever and never the part anybody is in. What was dropped is
 * counted and said.
 *
 * Pure, tested without a canvas, like everything else that decides what words
 * end up on a wall.
 */

export type ListRow = {
  primary: string;
  /** A name, a time, a reason — the quieter half. */
  secondary?: string;
  /** A stripe down the left, for status or for whose voice it is. */
  tint?: string;
  /** Drawn in the muted ink, for anything that is not currently true. */
  faded?: boolean;
};

export const LIST_PX = { width: 768, height: 480 } as const;

const TITLE_Y = 56;
const ROW_HEIGHT = 58;
const FIRST_ROW = 96;

/** How many rows fit, worked out rather than assumed. */
export const listCapacity = (height = LIST_PX.height): number =>
  Math.max(0, Math.floor((height - FIRST_ROW - 28) / ROW_HEIGHT));

export function paintList(
  title: string,
  rows: readonly ListRow[],
  measure: (text: string, size: number) => number,
  options: { empty?: string; newestLast?: boolean; leadWithSecondary?: boolean } = {},
): Ink[] {
  const { width, height } = LIST_PX;
  const pad = 32;
  const ink: Ink[] = [
    { kind: "rect", x: 0, y: 0, width, height, fill: CARD_INK.paper, radius: 20 },
    { kind: "text", x: pad, y: TITLE_Y, text: title, size: 34, fill: CARD_INK.ink, weight: "bold" },
    { kind: "line", x: pad, y: TITLE_Y + 18, width: width - pad * 2, height: 2, fill: CARD_INK.edge },
  ];

  if (rows.length === 0) {
    ink.push({
      kind: "text",
      x: pad,
      y: FIRST_ROW + 24,
      text: options.empty ?? "Nothing here yet.",
      size: 26,
      fill: CARD_INK.muted,
    });
    return ink;
  }

  const capacity = listCapacity(height);
  // THE TAIL for a growing list, the head for a fixed one. A roster does not
  // grow past the room; a transcript does, and its end is the interesting part.
  const shown = options.newestLast ? rows.slice(-capacity) : rows.slice(0, capacity);
  const dropped = rows.length - shown.length;

  let y = FIRST_ROW;
  for (const row of shown) {
    if (row.tint) {
      ink.push({ kind: "line", x: pad, y: y - 24, width: 6, height: 40, fill: row.tint });
    }
    /**
     * A TRANSCRIPT READS "WHO, THEN WHAT". A roster reads "who, and how they
     * are". So the quiet half leads on one and trails on the other.
     *
     * The speaker used to sit at the far right of the row — fine on a chat
     * window, and a long way from the words on a panel four metres wide, where
     * the eye has to cross the whole board to find out who said something.
     */
    if (options.leadWithSecondary && row.secondary) {
      const [who] = fitLines(measure, `${row.secondary}`, 24, 210, 1);
      const whoWidth = measure(who ?? "", 24) + 16;
      ink.push({ kind: "text", x: pad + 20, y, text: who ?? "", size: 24, fill: CARD_INK.accent, weight: "bold" });
      const [line] = fitLines(measure, row.primary, 27, width - pad * 2 - 28 - whoWidth, 1);
      ink.push({
        kind: "text",
        x: pad + 20 + whoWidth,
        y,
        text: line ?? "",
        size: 27,
        fill: row.faded ? CARD_INK.muted : CARD_INK.ink,
      });
    } else {
      const [line] = fitLines(measure, row.primary, 27, width - pad * 2 - 28 - (row.secondary ? 180 : 0), 1);
      ink.push({
        kind: "text",
        x: pad + 20,
        y,
        text: line ?? "",
        size: 27,
        fill: row.faded ? CARD_INK.muted : CARD_INK.ink,
      });
      if (row.secondary) {
        const [quiet] = fitLines(measure, row.secondary, 22, 170, 1);
        ink.push({ kind: "text", x: width - pad - 170, y, text: quiet ?? "", size: 22, fill: CARD_INK.muted });
      }
    }
    y += ROW_HEIGHT;
  }

  if (dropped > 0) {
    ink.push({
      kind: "text",
      x: pad,
      y: height - 18,
      text: options.newestLast ? `${dropped} earlier` : `${dropped} more`,
      size: 20,
      fill: CARD_INK.muted,
    });
  }

  return ink;
}
