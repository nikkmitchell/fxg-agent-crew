import { describe, expect, it } from "vitest";
import { CARD_PX, STATUS_STRIPE, fitLines, paintCard, type Ink } from "./card-paint.js";
import type { BoardCard } from "./board-3d.js";

/**
 * A card, tested without a canvas.
 *
 * `paintCard` returns instructions rather than pixels precisely so this can
 * exist: the suite has no renderer, so a function that draws would be untested,
 * and a card that silently overflows its own edge is unreadable in a way nobody
 * notices until they are wearing a headset.
 */

/** A measurer with predictable arithmetic: every glyph is 0.55 of the size. */
const measure = (text: string, size: number) => text.length * size * 0.55;

const card = (over: Partial<BoardCard> = {}): BoardCard => ({
  id: "t1",
  title: "Short title",
  status: "review",
  ...over,
});

const texts = (ink: Ink[]) => ink.flatMap((i) => (i.kind === "text" ? [i.text] : []));

describe("fitting a title into the card", () => {
  it("keeps a short title on one line", () => {
    expect(fitLines(measure, "Short title", 34, 400, 3)).toEqual(["Short title"]);
  });

  it("wraps rather than running past the edge", () => {
    const lines = fitLines(measure, "a title long enough that it cannot fit on one line at all", 34, 300, 3);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line, 34)).toBeLessThanOrEqual(300);
  });

  it("NEVER exceeds the line budget", () => {
    // Past this the card grows into its neighbour, which on a board of stacked
    // cards means overlapping text and nothing readable.
    const lines = fitLines(measure, Array.from({ length: 80 }, () => "word").join(" "), 34, 300, 3);
    expect(lines).toHaveLength(3);
  });

  it("elides rather than stopping mid-thought", () => {
    // A title that just stops reads as data loss. An ellipsis reads as "there
    // is more", which is true, and the detail panel is where more lives.
    const lines = fitLines(measure, Array.from({ length: 80 }, () => "word").join(" "), 34, 300, 3);
    expect(lines[2].endsWith("…")).toBe(true);
    expect(measure(lines[2], 34)).toBeLessThanOrEqual(300);
  });

  it("does not elide when everything fitted", () => {
    expect(fitLines(measure, "two words", 34, 900, 3).join("")).not.toContain("…");
  });

  it("survives an empty or whitespace title without throwing", () => {
    expect(fitLines(measure, "", 34, 300, 3)).toEqual([]);
    expect(fitLines(measure, "   ", 34, 300, 3)).toEqual([]);
  });

  it("puts a single unbreakable word on the line rather than looping forever", () => {
    const lines = fitLines(measure, "supercalifragilisticexpialidocious", 34, 50, 3);
    expect(lines).toHaveLength(1);
  });
});

describe("painting a card", () => {
  it("is deterministic: the same card twice is the same instructions", () => {
    // Because the texture is only repainted when content changes, a painter
    // that varied would leave two cards looking different for no reason.
    expect(paintCard(card(), measure)).toEqual(paintCard(card(), measure));
  });

  it("shows the title", () => {
    expect(texts(paintCard(card({ title: "Fix the thing" }), measure)).join(" ")).toContain("Fix the thing");
  });

  it("stripes by status, so a card is recognisable without reading it", () => {
    const review = paintCard(card({ status: "review" }), measure);
    const done = paintCard(card({ status: "done" }), measure);
    const stripeOf = (ink: Ink[]) => ink.find((i) => i.kind === "line")?.fill;
    expect(stripeOf(review)).toBe(STATUS_STRIPE.review);
    expect(stripeOf(done)).toBe(STATUS_STRIPE.done);
    expect(stripeOf(review)).not.toBe(stripeOf(done));
  });

  it("falls back to an edge colour for a status it does not know", () => {
    expect(() => paintCard(card({ status: "invented" }), measure)).not.toThrow();
  });

  it("omits the footer entirely when there is nothing to say", () => {
    // Rather than printing "unassigned · 0 comments", which is a line of words
    // meaning nothing.
    const ink = paintCard(card(), measure);
    expect(texts(ink)).toEqual(["Short title"]);
  });

  it("names who has it, and how many have spoken", () => {
    const ink = paintCard(card({ assigneeId: "Sill", commentCount: 2 }), measure);
    const footer = texts(ink).join(" ");
    expect(footer).toContain("Sill");
    expect(footer).toContain("2 comments");
  });

  it("says one comment, not 1 comments", () => {
    expect(texts(paintCard(card({ commentCount: 1 }), measure)).join(" ")).toContain("1 comment");
  });

  it("keeps everything inside the card", () => {
    // The check that matters for a texture: nothing may be drawn outside the
    // bitmap, or it is simply not there.
    const ink = paintCard(card({ title: "a very long title ".repeat(8), assigneeId: "Nightjar", commentCount: 9 }), measure);
    for (const item of ink) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(CARD_PX.width);
      expect(item.y).toBeLessThanOrEqual(CARD_PX.height);
    }
  });

  it("wears a different face when held or refused, from the SAME painter", () => {
    // One function, three moods. Separate painters are how a held card and a
    // resting card end up disagreeing about where the title sits.
    const resting = paintCard(card(), measure, "resting");
    const held = paintCard(card(), measure, "held");
    const refused = paintCard(card(), measure, "refused");
    expect(texts(held)).toEqual(texts(resting));
    expect(texts(refused)).toEqual(texts(resting));
    expect(held[0]).not.toEqual(resting[0]);
    expect(refused.length).toBeGreaterThan(resting.length);
  });
});
