/**
 * The task board grows taller as cards are added.
 *
 * Nikk: "adjust the task board so that the vertical length of it increases as
 * the number of tasks are added, so that its always long enough for all the
 * tasks to be shown".
 *
 * UPWARD, from its bottom edge. The panel's bottom sits a little above the
 * floor; growing downward would sink the cards into it. The top rises instead,
 * and never beyond four times the panel's set height, so a runaway backlog
 * makes a tall board rather than a tower.
 */

/** Only the task board grows; the other panels are pages of their own shape. */
export const GROWING_PANELS: ReadonlySet<string> = new Set(["taskBoard"]);

export const MAX_GROWTH = 4;

/**
 * How tall a board page needs to be, as opposed to how tall it is drawn.
 *
 * THE BOARD NOW FILLS ITS WINDOW, so its titles sit on the bottom edge — and
 * inside a panel the window IS the panel. Measured naively, a page that fills
 * the panel always needs exactly the panel, and a panel that grew for a long
 * column would never shrink back once the cards moved on. So the empty space
 * every column still has above its cards is taken off: that space is the
 * stretch, not the content.
 *
 * `spareInColumns` is, for each column, how many pixels of it are empty. The
 * smallest of them is the stretch every column shares.
 */
export function naturalHeight(pageHeight: number, spareInColumns: number[]): number {
  if (spareInColumns.length === 0) return pageHeight;
  return pageHeight - Math.max(0, Math.min(...spareInColumns));
}

/**
 * How tall to draw a panel whose set height is `setHeight` metres, when its
 * content needs `neededHeight` metres; and how far to raise its centre so its
 * bottom edge stays where it was.
 */
export function grownPanel(setHeight: number, neededHeight: number | null): { height: number; lift: number } {
  if (neededHeight === null || !(neededHeight > setHeight)) return { height: setHeight, lift: 0 };
  const height = Math.min(neededHeight, setHeight * MAX_GROWTH);
  return { height, lift: (height - setHeight) / 2 };
}
