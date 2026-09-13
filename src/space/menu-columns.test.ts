import { describe, expect, test } from "vitest";
import { CONTINUED, columnX, gridSlots, toColumns } from "./menu-columns";

const box = (title: string, count: number) => ({
  title,
  rows: Array.from({ length: count }, (_, at) => `${title}-${at}`),
});

describe("toColumns", () => {
  test("a group that fits stays one column", () => {
    expect(toColumns([box("Talking", 4)], 7)).toEqual([
      { title: "Talking", rows: ["Talking-0", "Talking-1", "Talking-2", "Talking-3"] },
    ]);
  });

  test("NO COLUMN IS EVER TALLER THAN THE LIMIT", () => {
    // The whole point. A column past this height runs off the bottom of what
    // somebody in a headset can see or reach, which is how the board choices
    // became unreachable.
    const columns = toColumns([box("Panels", 20)], 7);
    for (const column of columns) expect(column.rows.length).toBeLessThanOrEqual(7);
    expect(columns).toHaveLength(3);
  });

  test("a spilled column is marked rather than repeating the heading", () => {
    // Two columns both titled "Panels" read as two separate groups.
    const columns = toColumns([box("Panels", 9)], 7);
    expect(columns[0].title).toBe("Panels");
    expect(columns[1].title).toBe(CONTINUED);
  });

  test("nothing is lost or duplicated in the split", () => {
    const rows = box("Panels", 17).rows;
    const flat = toColumns([{ title: "Panels", rows }], 5).flatMap((column) => column.rows);
    expect(flat).toEqual(rows);
  });

  test("groups keep their order", () => {
    const columns = toColumns([box("A", 2), box("B", 2)], 7);
    expect(columns.map((column) => column.title)).toEqual(["A", "B"]);
  });

  test("an empty group still gets a heading", () => {
    // "There is nothing here" and "this group does not exist" are different.
    expect(toColumns([{ title: "Panels", rows: [] }], 7)).toEqual([{ title: "Panels", rows: [] }]);
  });

  test("a nonsense limit still produces something usable", () => {
    const columns = toColumns([box("A", 3)], 0);
    for (const column of columns) expect(column.rows.length).toBe(1);
  });
});

describe("columnX", () => {
  test("one column sits straight ahead", () => {
    expect(columnX(0, 1, 0.56, 0.08)).toBeCloseTo(0, 10);
  });

  test("a pair straddles the middle evenly", () => {
    const left = columnX(0, 2, 0.56, 0.08);
    const right = columnX(1, 2, 0.56, 0.08);
    expect(left).toBeCloseTo(-right, 10);
    expect(right - left).toBeCloseTo(0.64, 10);
  });

  test("the grid stays centred however many columns there are", () => {
    for (const count of [1, 2, 3, 4, 5]) {
      const first = columnX(0, count, 0.56, 0.08);
      const last = columnX(count - 1, count, 0.56, 0.08);
      expect(first + last).toBeCloseTo(0, 10);
    }
  });
});

describe("gridSlots", () => {
  test("a few columns stay in one row", () => {
    expect(gridSlots(3, 3)).toEqual([
      { row: 0, col: 0, inRow: 3 },
      { row: 0, col: 1, inRow: 3 },
      { row: 0, col: 2, inRow: 3 },
    ]);
  });

  test("too many wrap onto a second row rather than spreading wider", () => {
    const slots = gridSlots(5, 3);
    expect(slots.map((slot) => slot.row)).toEqual([0, 0, 0, 1, 1]);
    expect(slots.map((slot) => slot.col)).toEqual([0, 1, 2, 0, 1]);
  });

  test("each row knows its own width, so a short last row is centred", () => {
    // Otherwise a final row of two hangs off to the left under a row of three.
    const slots = gridSlots(5, 3);
    expect(slots[3].inRow).toBe(2);
    expect(slots[4].inRow).toBe(2);
  });

  test("never wider than asked, however many columns there are", () => {
    for (const count of [1, 4, 7, 12]) {
      for (const slot of gridSlots(count, 3)) expect(slot.col).toBeLessThan(3);
    }
  });

  test("a nonsense row width still lays out one per row", () => {
    expect(gridSlots(3, 0).map((slot) => slot.row)).toEqual([0, 1, 2]);
  });
});
