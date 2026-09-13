/**
 * Turning groups of buttons into columns that fit in front of a person.
 *
 * THE BUG THIS EXISTS TO PREVENT. The settings were one column. At eight or ten
 * rows that is a strip running from your chin to the floor, and the rows at the
 * bottom of it cannot be reached or even seen — which is how the board choices
 * came to be invisible despite being right there in the menu. Nikk, from inside
 * a headset: "the in VR settings are almost unusable... ahve it set up in
 * seperate boxes."
 *
 * So no column may be taller than `maxRows`, and a group that does not fit
 * continues into another column beside it rather than growing downward.
 */
export type MenuColumn<Row> = { title: string; rows: Row[] };

/** A continued column is marked rather than repeating its group's heading. */
export const CONTINUED = "…";

export function toColumns<Row>(
  boxes: { title: string; rows: Row[] }[],
  maxRows: number,
): MenuColumn<Row>[] {
  const columns: MenuColumn<Row>[] = [];
  const limit = Math.max(1, maxRows);
  for (const box of boxes) {
    // An empty group still gets a column: a heading with nothing under it says
    // "there is nothing here", which is different from the group being absent.
    if (box.rows.length === 0) {
      columns.push({ title: box.title, rows: [] });
      continue;
    }
    for (let at = 0; at < box.rows.length; at += limit) {
      columns.push({
        title: at === 0 ? box.title : CONTINUED,
        rows: box.rows.slice(at, at + limit),
      });
    }
  }
  return columns;
}

/** Where column `index` of `count` sits, so the grid is centred on the viewer. */
export function columnX(index: number, count: number, width: number, gap: number): number {
  const step = width + gap;
  const total = count * step - gap;
  return -total / 2 + width / 2 + index * step;
}

/**
 * Where each column sits when there are too many to stand in one row.
 *
 * WHY WRAP AT ALL. Five columns side by side is about seventy-five degrees
 * across at the distance this menu hangs — inside a headset's field of view,
 * but only just, and the outer ones have to be found by turning your head. A
 * menu you turn your head to read is the same complaint in a different
 * direction from the column that ran past your knees.
 *
 * Each row is centred on its own, so a final row of two sits under the middle
 * of a row of three rather than hanging off to the left.
 */
export function gridSlots(count: number, perRow: number): { row: number; col: number; inRow: number }[] {
  const width = Math.max(1, perRow);
  const slots: { row: number; col: number; inRow: number }[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / width);
    const inRow = Math.min(width, count - row * width);
    slots.push({ row, col: index % width, inRow });
  }
  return slots;
}
