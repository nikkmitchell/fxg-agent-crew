import { describe, expect, it } from "vitest";
import { paintNote, readableInk } from "./mood-paint.js";
import type { Ink } from "./card-paint.js";
import type { MoodItem } from "./mood-3d.js";

const measure = (text: string, size: number) => text.length * size * 0.55;
const said = (ink: Ink[]) => ink.flatMap((i) => (i.kind === "text" ? [i.text] : [])).join("   ");
const item = (over: Partial<MoodItem> = {}): MoodItem => ({
  id: "i1", kind: "note", x: 0, y: 0, w: 220, h: 120, z: 0, ...over,
});

describe("ink you can read on a colour", () => {
  it("is dark on pale and pale on dark", () => {
    expect(readableInk("#f7e7a1")).toBe("#121212");
    expect(readableInk("#10233f")).toBe("#f6f4ee");
  });

  it("handles the short form and a missing hash", () => {
    expect(readableInk("fff")).toBe("#121212");
    expect(readableInk("#000")).toBe("#f6f4ee");
  });

  it("WEIGHS GREEN MOST, which is what makes it right rather than nearly right", () => {
    // Pure green is bright, pure blue is not, though both are "one channel at
    // full". A naive average calls them the same and puts white on the green.
    expect(readableInk("#00ff00")).toBe("#121212");
    expect(readableInk("#0000ff")).toBe("#f6f4ee");
  });
});

describe("drawing what is not a picture", () => {
  it("paints a swatch AS ITS COLOUR, not as its own hex in words", () => {
    // The website learned this one the hard way: a swatch that falls through to
    // the note case prints its hex as a line of text, which is the one thing a
    // swatch cannot usefully be.
    const ink = paintNote(item({ kind: "swatch", text: "#c94f3d" }), measure);
    const plate = ink.find((i) => i.kind === "rect");
    expect(plate && plate.fill).toBe("#c94f3d");
    // The value is still readable on top.
    expect(said(ink)).toContain("#C94F3D");
  });

  it("treats a swatch with nonsense in it as a note rather than painting nonsense", () => {
    const ink = paintNote(item({ kind: "swatch", text: "not a colour" }), measure);
    const plate = ink.find((i) => i.kind === "rect");
    expect(plate && plate.fill).not.toBe("not a colour");
    expect(said(ink)).toContain("not a colour");
  });

  it("wraps a long note instead of running off the side", () => {
    const long = Array.from({ length: 40 }, () => "word").join(" ");
    const lines = paintNote(item({ text: long }), measure).filter((i) => i.kind === "text");
    expect(lines.length).toBeGreaterThan(1);
  });

  it("says who added it when anyone did", () => {
    expect(said(paintNote(item({ text: "hello", addedBy: "Nikk2" }), measure))).toContain("Nikk2");
  });

  it("says something rather than nothing for an empty note", () => {
    // A blank rectangle on a wall reads as a rendering fault.
    expect(said(paintNote(item({ text: "" }), measure))).toContain("empty");
  });

  it("marks a link differently from a note", () => {
    const link = paintNote(item({ kind: "link", text: "https://saha.ing" }), measure);
    const note = paintNote(item({ kind: "note", text: "https://saha.ing" }), measure);
    const fillOf = (ink: Ink[]) => ink.find((i) => i.kind === "text")?.fill;
    expect(fillOf(link)).not.toBe(fillOf(note));
  });

  it("is deterministic", () => {
    expect(paintNote(item({ text: "same" }), measure)).toEqual(paintNote(item({ text: "same" }), measure));
  });
});
