import { describe, expect, it } from "vitest";
import { MOOD, layOutMood, moodBounds, moodItemAt, moodMove, type MoodItem } from "./mood-3d.js";

const item = (id: string, over: Partial<MoodItem> = {}): MoodItem => ({
  id, kind: "note", x: 100, y: 100, w: 220, h: 120, z: 0, ...over,
});

const uvOf = (layout: ReturnType<typeof layOutMood>, x: number, y: number) => ({
  x: x / layout.width + 0.5,
  y: y / layout.height + 0.5,
});

describe("fitting a mood board to a panel", () => {
  it("puts every item inside the panel", () => {
    // Nothing may be cropped: the edge is where people put the last thing they
    // added.
    const items = [
      item("a", { x: 0, y: 0 }),
      item("b", { x: 1400, y: 60 }),
      item("c", { x: 300, y: 900, w: 500, h: 400 }),
    ];
    const layout = layOutMood(items);
    for (const place of layout.places) {
      expect(Math.abs(place.x) + place.width / 2, place.item.id).toBeLessThanOrEqual(MOOD.width / 2 + 1e-9);
      expect(Math.abs(place.y) + place.height / 2, place.item.id).toBeLessThanOrEqual(MOOD.height / 2 + 1e-9);
    }
  });

  it("KEEPS EVERY ITEM'S SHAPE, using one scale for both axes", () => {
    // Fitting each axis separately stretches every picture to a shape its owner
    // did not choose, which is the one thing a mood board must not do.
    const items = [item("wide", { x: 0, y: 0, w: 800, h: 100 }), item("tall", { x: 0, y: 400, w: 100, h: 800 })];
    const layout = layOutMood(items);
    for (const place of layout.places) {
      expect(place.width / place.height).toBeCloseTo(place.item.w / place.item.h, 6);
    }
  });

  it("draws back to front so the top item is on top", () => {
    const layout = layOutMood([item("under", { z: 0 }), item("over", { z: 5 })]);
    expect(layout.places.map((p) => p.item.id)).toEqual(["under", "over"]);
  });

  it("finds the FRONTMOST item where two overlap", () => {
    // Overlap is what a collage is. The one you can see is the one you meant.
    const layout = layOutMood([item("under", { z: 0 }), item("over", { z: 9 })]);
    const place = layout.places.find((p) => p.item.id === "over")!;
    expect(moodItemAt(layout, uvOf(layout, place.x, place.y))?.item.id).toBe("over");
  });

  it("finds nothing in an empty corner", () => {
    const layout = layOutMood([item("a")]);
    expect(moodItemAt(layout, { x: 0.02, y: 0.02 })).toBeNull();
  });

  it("survives an empty board without dividing by zero", () => {
    const layout = layOutMood([]);
    expect(layout.places).toEqual([]);
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(layout.scale).toBeGreaterThan(0);
  });

  it("does not blow one small note up to fill a wall", () => {
    // Fitting a single 220x120 note to a four-metre panel would look like a
    // rendering fault rather than like a note.
    const layout = layOutMood([item("only")]);
    const place = layout.places[0];
    expect(place.width).toBeLessThan(MOOD.width / 2);
  });
});

describe("moving an item from the room", () => {
  it("lands where the website would have put it", () => {
    // Otherwise the two views disagree about where things are, and every
    // arrangement is undone by whoever looks at it next.
    const items = [item("a", { x: 100, y: 100 }), item("b", { x: 900, y: 700 })];
    const layout = layOutMood(items);
    const from = uvOf(layout, 0, 0);
    // Half a metre right and a quarter down, in panel terms.
    const to = { x: from.x + 0.5 / layout.width, y: from.y - 0.25 / layout.height };
    const moved = moodMove(layout, items[0], from, to);
    expect(moved.x).toBe(Math.round(100 + 0.5 / layout.scale));
    expect(moved.y).toBe(Math.round(100 + 0.25 / layout.scale));
  });

  it("does not move an item that did not move", () => {
    const items = [item("a")];
    const layout = layOutMood(items);
    const at = uvOf(layout, 0, 0);
    expect(moodMove(layout, items[0], at, at)).toEqual({ x: 100, y: 100 });
  });

  it("gives whole pixels, because the board is stored in them", () => {
    const items = [item("a")];
    const layout = layOutMood(items);
    const moved = moodMove(layout, items[0], { x: 0.5, y: 0.5 }, { x: 0.5137, y: 0.4821 });
    expect(Number.isInteger(moved.x)).toBe(true);
    expect(Number.isInteger(moved.y)).toBe(true);
  });
});

describe("the bounds it fits", () => {
  it("covers everything on the board", () => {
    const items = [item("a", { x: -200, y: 50 }), item("b", { x: 1000, y: 900, w: 300, h: 300 })];
    const bounds = moodBounds(items);
    for (const one of items) {
      expect(one.x).toBeGreaterThanOrEqual(bounds.x);
      expect(one.y).toBeGreaterThanOrEqual(bounds.y);
      expect(one.x + one.w).toBeLessThanOrEqual(bounds.x + bounds.width + 1e-9);
      expect(one.y + one.h).toBeLessThanOrEqual(bounds.y + bounds.height + 1e-9);
    }
  });
});
