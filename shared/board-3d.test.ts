import { describe, expect, it } from "vitest";
import { BOARD, BOARD_COLUMNS, cardAt, columnAt, layOutBoard, moveRefusal, pointFromUv, uvFromPanelPoint, type BoardCard } from "./board-3d.js";
import { canTransition } from "./board-rules.js";

/**
 * The board's geometry, tested without a renderer.
 *
 * WHY THIS IS WORTH TESTING AT ALL: the renderer and the pointer both read
 * these numbers, and if they disagree by so much as a card's height then a card
 * is drawn in one place and picked up from another. That is not a visual bug
 * you notice — it is a card that cannot be grabbed, which looks like a broken
 * hand tracker.
 *
 * None of it needs three.js, which is the reason it lives here rather than in
 * the component: this suite has no renderer, so anything inside a component is
 * effectively untested.
 */

const card = (id: string, status: string, title = id): BoardCard => ({ id, title, status });

describe("laying out the work board", () => {
  it("gives every status a column, including blocked", () => {
    // A board that hides a column cannot be used to move a card INTO it, and
    // moving cards between columns is the whole feature.
    const layout = layOutBoard([]);
    expect(layout.columns.map((c) => c.status)).toEqual(BOARD_COLUMNS.map((c) => c.status));
    expect(layout.columns.map((c) => c.status)).toContain("blocked");
  });

  it("puts columns left to right, in the order the rules define", () => {
    const layout = layOutBoard([]);
    const xs = layout.columns.map((c) => c.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("stacks a column's cards downward from the top, in the order given", () => {
    const layout = layOutBoard([card("a", "backlog"), card("b", "backlog"), card("c", "backlog")]);
    const column = layout.cards.filter((p) => p.card.status === "backlog");
    expect(column.map((p) => p.card.id)).toEqual(["a", "b", "c"]);
    expect(column[0].y).toBeGreaterThan(column[1].y);
    expect(column[1].y).toBeGreaterThan(column[2].y);
  });

  it("keeps every card inside the panel", () => {
    // A card drawn past the frame is a card that cannot be reached.
    const many = Array.from({ length: 40 }, (_, i) => card(`t${i}`, "review"));
    const layout = layOutBoard(many);
    for (const place of layout.cards) {
      expect(Math.abs(place.y) + place.height / 2).toBeLessThanOrEqual(layout.height / 2 + 1e-9);
      expect(Math.abs(place.x) + place.width / 2).toBeLessThanOrEqual(layout.width / 2 + 1e-9);
    }
  });

  it("SAYS how many it could not draw rather than silently stopping", () => {
    // A column that quietly stops at the tenth card is a board lying about how
    // much work there is.
    const many = Array.from({ length: 40 }, (_, i) => card(`t${i}`, "review"));
    const layout = layOutBoard(many);
    const drawn = layout.cards.filter((p) => p.card.status === "review").length;
    const hidden = layout.overflow.find((o) => o.status === "review")?.hidden ?? 0;
    expect(drawn).toBeGreaterThan(0);
    expect(drawn + hidden).toBe(40);
  });

  it("does not report overflow when everything fits", () => {
    expect(layOutBoard([card("a", "done")]).overflow).toEqual([]);
  });
});

describe("finding the card under a pointer", () => {
  /** The uv three.js reports for a panel-local point: u right, v UP. */
  const uvOf = (layout: { width: number; height: number }, x: number, y: number) => ({
    x: x / layout.width + 0.5,
    y: y / layout.height + 0.5,
  });

  it("finds the card the renderer drew there — the same numbers, both ways", () => {
    // THE WHOLE POINT. Draw at a place, point at that place, get that card.
    const layout = layOutBoard([card("a", "backlog"), card("b", "backlog"), card("c", "review")]);
    for (const place of layout.cards) {
      const hit = cardAt(layout, uvOf(layout, place.x, place.y));
      expect(hit?.card.id, `pointing at where ${place.card.id} was drawn`).toBe(place.card.id);
    }
  });

  it("is not fooled by y-up versus y-down", () => {
    // The conversion lives in one place precisely so this cannot be wrong in
    // one of two. Top card in the column must be hit by a HIGH v.
    const layout = layOutBoard([card("top", "backlog"), card("below", "backlog")]);
    const top = layout.cards.find((p) => p.card.id === "top")!;
    const below = layout.cards.find((p) => p.card.id === "below")!;
    expect(top.y).toBeGreaterThan(below.y);
    expect(cardAt(layout, uvOf(layout, top.x, top.y))?.card.id).toBe("top");
    expect(uvOf(layout, top.x, top.y).y).toBeGreaterThan(uvOf(layout, below.x, below.y).y);
  });

  it("returns null in the gap between cards rather than the nearest one", () => {
    // Precision matters here and not for columns: picking up the wrong card is
    // worse than picking up none.
    const layout = layOutBoard([card("a", "backlog"), card("b", "backlog")]);
    const a = layout.cards[0];
    const between = a.y - a.height / 2 - BOARD.cardGap / 2;
    expect(cardAt(layout, uvOf(layout, a.x, between))).toBeNull();
  });

  it("returns null off the panel", () => {
    const layout = layOutBoard([card("a", "backlog")]);
    expect(cardAt(layout, { x: 2, y: 0.5 })).toBeNull();
  });
});

describe("choosing the column for a drop", () => {
  const uvOf = (layout: { width: number; height: number }, x: number, y: number) => ({
    x: x / layout.width + 0.5,
    y: y / layout.height + 0.5,
  });

  it("takes the NEAREST column, so a drop in a gutter still lands", () => {
    // A headset cannot deliver four-millimetre precision and a person should
    // not have to. Strict containment would refuse this drop.
    const layout = layOutBoard([]);
    const first = layout.columns[0];
    const second = layout.columns[1];
    const gutter = (first.x + second.x) / 2 - 0.001;
    expect(columnAt(layout, uvOf(layout, gutter, 0))?.status).toBe(first.status);
  });

  it("lands in the column you are over", () => {
    const layout = layOutBoard([]);
    for (const column of layout.columns) {
      expect(columnAt(layout, uvOf(layout, column.x, 0))?.status).toBe(column.status);
    }
  });

  it("returns null OFF the panel, because that is a drop into the room", () => {
    // Not a failure: it is how a card gets pulled off the board into its own
    // panel, which is a thing Nikk asked for.
    const layout = layOutBoard([]);
    expect(columnAt(layout, uvOf(layout, layout.width, 0))).toBeNull();
  });
});

describe("refusing a move before the card lands", () => {
  it("asks the SAME rule the server will", () => {
    // Not a second table of legal moves. One would drift, and then the board
    // would welcome a card the server then rejects.
    const legal = moveRefusal("backlog", "assigned", canTransition);
    const illegal = moveRefusal("backlog", "done", canTransition);
    expect(legal).toBeNull();
    expect(illegal).not.toBeNull();
    // And it agrees with the rule it consulted.
    expect(canTransition("backlog", "assigned")).toBe(true);
    expect(canTransition("backlog", "done")).toBe(false);
  });

  it("allows a drop back where it came from", () => {
    expect(moveRefusal("review", "review" as never, canTransition)).toBeNull();
  });

  it("names both ends in the refusal, in the words on the columns", () => {
    // "a card cannot go from Backlog to Done" — the labels the person is
    // looking at, not the database's spelling.
    const refusal = moveRefusal("backlog", "done", canTransition) ?? "";
    expect(refusal).toContain("Backlog");
    expect(refusal).toContain("Done");
  });

  it("refuses a status the board does not know rather than guessing", () => {
    expect(moveRefusal("nonsense", "done", canTransition)).toContain("nonsense");
  });
});

describe("uv to panel metres", () => {
  it("puts the centre at the centre and the corners at the corners", () => {
    const layout = layOutBoard([]);
    expect(pointFromUv(layout, { x: 0.5, y: 0.5 })).toEqual({ x: 0, y: 0 });
    expect(pointFromUv(layout, { x: 1, y: 1 })).toEqual({ x: layout.width / 2, y: layout.height / 2 });
    expect(pointFromUv(layout, { x: 0, y: 0 })).toEqual({ x: -layout.width / 2, y: -layout.height / 2 });
  });
});

describe("the board fills the panel it is given", () => {
  /**
   * THE BUG THIS EXISTS FOR. The room drew the board at the default 2.4 × 1.5
   * on a panel that is 4.0 × 2.5, so it used sixty per cent of its own surface
   * and the rest was blank cream — and making the panel bigger only made the
   * blank part bigger. The size parameter was there the whole time; nothing
   * checked that passing one changed anything, so nothing noticed it was never
   * passed.
   */
  const sized = (width: number, height: number) => ({ ...BOARD, width, height });
  const many = Array.from({ length: 40 }, (_, i) => card(`c${i}`, "backlog"));

  it("uses the width it is given", () => {
    const wide = layOutBoard([], sized(4.0, 2.5));
    expect(wide.width).toBe(4.0);
    expect(wide.height).toBe(2.5);
    // And the columns actually spread across it rather than huddling.
    const last = wide.columns[wide.columns.length - 1];
    expect(last.x + last.width / 2).toBeCloseTo(4.0 / 2 - BOARD.padding, 5);
  });

  it("gives wider columns on a wider panel", () => {
    const narrow = layOutBoard([], sized(2.4, 1.5));
    const wide = layOutBoard([], sized(4.0, 2.5));
    expect(wide.columns[0].width).toBeGreaterThan(narrow.columns[0].width);
  });

  it("FITS MORE CARDS ON A TALLER PANEL, which is the point of resizing one", () => {
    // A person who cannot read a crowded column makes the panel bigger. If that
    // does not show more cards it is a magnifier, not a resize.
    const short = layOutBoard(many, sized(2.4, 1.5));
    const tall = layOutBoard(many, sized(2.4, 2.5));
    expect(tall.cards.length).toBeGreaterThan(short.cards.length);
    const shortHidden = short.overflow.reduce((sum, o) => sum + o.hidden, 0);
    const tallHidden = tall.overflow.reduce((sum, o) => sum + o.hidden, 0);
    expect(tallHidden).toBeLessThan(shortHidden);
  });

  it("keeps every card inside the panel at any size", () => {
    for (const [w, h] of [[2.4, 1.5], [4.0, 2.5], [1.6, 1.0], [6.0, 3.2]] as const) {
      const layout = layOutBoard(many, sized(w, h));
      for (const place of layout.cards) {
        expect(Math.abs(place.x) + place.width / 2, `${w}x${h} card off the side`).toBeLessThanOrEqual(w / 2 + 1e-9);
        expect(Math.abs(place.y) + place.height / 2, `${w}x${h} card off the top`).toBeLessThanOrEqual(h / 2 + 1e-9);
      }
    }
  });
});

describe("uv from a panel point", () => {
  /**
   * The regression for the bug that made every card drag do nothing: the room
   * was reading a per-mesh uv and treating it as a board position.
   */
  it("is the exact inverse of pointFromUv", () => {
    const layout = layOutBoard([card("a", "review")]);
    for (const uv of [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 0.23, y: 0.77 }]) {
      const back = uvFromPanelPoint(layout, pointFromUv(layout, uv));
      expect(back.x).toBeCloseTo(uv.x, 10);
      expect(back.y).toBeCloseTo(uv.y, 10);
    }
  });

  it("finds the card the layout put there, from the point the layout gave", () => {
    // The whole round trip: layout says a card is at (x, y); converting that
    // point back to uv and asking `cardAt` must return the same card. This is
    // the step the room got wrong.
    const cards = [card("a", "review"), card("b", "review"), card("c", "backlog")];
    const layout = layOutBoard(cards, { ...BOARD, width: 4.0, height: 2.5 });
    for (const place of layout.cards) {
      const uv = uvFromPanelPoint(layout, { x: place.x, y: place.y });
      expect(cardAt(layout, uv)?.card.id, `centre of ${place.card.id}`).toBe(place.card.id);
    }
  });

  it("grows to the right and upward, so a wrong mapping cannot look right", () => {
    // The observed symptom was a uv that went DOWN as the pointer went right.
    const layout = layOutBoard([], { ...BOARD, width: 4.0, height: 2.5 });
    expect(uvFromPanelPoint(layout, { x: 1, y: 0 }).x).toBeGreaterThan(uvFromPanelPoint(layout, { x: -1, y: 0 }).x);
    expect(uvFromPanelPoint(layout, { x: 0, y: 1 }).y).toBeGreaterThan(uvFromPanelPoint(layout, { x: 0, y: -1 }).y);
  });
});
