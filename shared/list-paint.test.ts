import { describe, expect, it } from "vitest";
import { LIST_PX, listCapacity, paintList, type ListRow } from "./list-paint.js";
import type { Ink } from "./card-paint.js";

const measure = (text: string, size: number) => text.length * size * 0.55;
const texts = (ink: Ink[]) => ink.flatMap((i) => (i.kind === "text" ? [i.text] : []));
const said = (ink: Ink[]) => texts(ink).join("   ");
const rows = (n: number, prefix = "row"): ListRow[] =>
  Array.from({ length: n }, (_, i) => ({ primary: `${prefix} ${i}` }));

describe("a titled list on a panel", () => {
  it("says its title and its rows", () => {
    const words = said(paintList("In the room", [{ primary: "Nikk", secondary: "here" }], measure));
    expect(words).toContain("In the room");
    expect(words).toContain("Nikk");
    expect(words).toContain("here");
  });

  it("says so when there is nothing, rather than showing a blank wall", () => {
    // An empty rectangle in a room reads as a rendering fault.
    expect(said(paintList("Said in the room", [], measure, { empty: "Nobody has said anything." })))
      .toContain("Nobody has said anything");
  });

  it("KEEPS THE TAIL of a transcript, which is the part anybody is in", () => {
    // Drawing from the beginning would show the start of a conversation
    // forever and never the part that is happening.
    const words = said(paintList("Said", rows(80, "line"), measure, { newestLast: true }));
    expect(words).toContain("line 79");
    expect(words).not.toContain("line 0 ");
  });

  it("keeps the head of a roster, which does not grow past the room", () => {
    const words = said(paintList("People", rows(80, "person"), measure));
    expect(words).toContain("person 0");
  });

  it("counts what it could not show, in the right direction", () => {
    expect(said(paintList("Said", rows(80), measure, { newestLast: true }))).toContain("earlier");
    expect(said(paintList("People", rows(80), measure))).toContain("more");
  });

  it("is quiet about overflow when everything fits", () => {
    const words = said(paintList("People", rows(3), measure));
    expect(words).not.toContain("more");
    expect(words).not.toContain("earlier");
  });

  it("fits exactly what it says it fits", () => {
    const capacity = listCapacity();
    const ink = paintList("People", rows(capacity), measure);
    expect(said(ink)).not.toContain("more");
    expect(said(paintList("People", rows(capacity + 1), measure))).toContain("1 more");
  });

  it("elides a long line instead of running off the panel", () => {
    const long = Array.from({ length: 60 }, () => "word").join(" ");
    for (const item of paintList("People", [{ primary: long }], measure)) {
      expect(item.x).toBeLessThanOrEqual(LIST_PX.width);
    }
  });

  it("stays inside the bitmap when crowded", () => {
    for (const item of paintList("Said", rows(200, "a long line of conversation"), measure, { newestLast: true })) {
      expect(item.x).toBeGreaterThanOrEqual(0);
      expect(item.y).toBeGreaterThanOrEqual(0);
      expect(item.x).toBeLessThanOrEqual(LIST_PX.width);
      expect(item.y).toBeLessThanOrEqual(LIST_PX.height);
    }
  });

  it("fades a row that is not currently true", () => {
    const here = paintList("People", [{ primary: "Wren" }], measure);
    const gone = paintList("People", [{ primary: "Wren", faded: true }], measure);
    const inkOf = (list: Ink[]) => list.find((i) => i.kind === "text" && i.text === "Wren")?.fill;
    expect(inkOf(here)).not.toBe(inkOf(gone));
  });

  it("is deterministic", () => {
    expect(paintList("People", rows(4), measure)).toEqual(paintList("People", rows(4), measure));
  });
});
