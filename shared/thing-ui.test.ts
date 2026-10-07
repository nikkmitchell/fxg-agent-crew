import { describe, expect, it } from "vitest";
import type { Ink } from "./card-paint";
import { buttonInk, cardInk, cardPages, uiPixels, wrapText, UI_MAX_PX, UI_PX_PER_METRE, UI_TEXT } from "./thing-ui";
import { UI_INK } from "./ui-ink";

/** About half an em a character: enough to say what fits without a canvas. */
const measure = (text: string, size: number) => text.length * size * 0.5;
const texts = (ink: Ink[]) => ink.filter((item): item is Extract<Ink, { kind: "text" }> => item.kind === "text");
const rects = (ink: Ink[]) => ink.filter((item): item is Extract<Ink, { kind: "rect" }> => item.kind === "rect");

describe("the platform's look for a thing's parts (Mica 7331)", () => {
  it("draws at the settings menu's density, and a big part coarser rather than bigger", () => {
    expect(UI_PX_PER_METRE).toBe(900);
    expect(uiPixels(0.25, 0.09)).toEqual({ width: 225, height: 81, scale: 1 });
    const big = uiPixels(3, 1);
    expect(big.width).toBe(UI_MAX_PX);
    expect(big.scale).toBeCloseTo(UI_MAX_PX / 2700);
  });

  it("gives a button its own glass, the menu's fill for its state, and its label in the middle", () => {
    const at = (state: "rest" | "hover" | "pressed" | "disabled", tone: "normal" | "accent" | "danger" = "normal") =>
      buttonInk({ label: "Read source", tone, state, width: 225, height: 81 }, measure);
    const [glass, over] = rects(at("rest"));
    expect(glass).toMatchObject({ fill: UI_INK.panelTop, stroke: UI_INK.panelEdge, radius: 40.5 });
    expect(over.fill).toBe(UI_INK.control);
    expect(rects(at("hover"))[1].fill).toBe(UI_INK.controlHover);
    expect(rects(at("pressed"))[1].fill).toBe(UI_INK.accent);
    expect(rects(at("rest", "accent"))[1].fill).toBe(UI_INK.accent);
    expect(rects(at("hover", "accent"))[1].fill).toBe(UI_INK.accentHover);
    const [label] = texts(at("rest"));
    expect(label).toMatchObject({ text: "Read source", align: "center", x: 112.5, fill: UI_INK.text, weight: "bold" });
    expect(texts(at("disabled"))[0].fill).toBe(UI_INK.faint);
    expect(texts(at("rest", "danger"))[0].fill).toBe(UI_INK.danger);
    expect(texts(at("pressed", "danger"))[0].fill).toBe(UI_INK.onAccent);
  });

  it("puts a label too long for one line on two, inside the rounded ends, and only then cuts it (Nikk 7447)", () => {
    const two = texts(buttonInk({ label: "Feedback about: earlier version", state: "rest", width: 360, height: 81 }, measure));
    expect(two).toHaveLength(2);
    expect(two.map((line) => line.text).join(" ")).toBe("Feedback about: earlier version");
    expect(two.every((line) => measure(line.text, line.size) <= 360 - 81 * 0.6)).toBe(true);
    const cut = texts(buttonInk({ label: "A label far too long for this little button even on two lines of it", state: "rest", width: 225, height: 81 }, measure));
    expect(cut).toHaveLength(2);
    expect(cut[1].text.endsWith("…")).toBe(true);
    expect(cut.every((line) => measure(line.text, line.size) <= 225 - 81 * 0.6)).toBe(true);
  });

  it("sets a card's text as large as fits, down to the least, then says it did not fit", () => {
    const short = cardInk({ title: "Three.js BoxGeometry", text: "A small editable-geometry reference.", width: 900, height: 400 }, measure);
    expect(short).toMatchObject({ size: UI_TEXT.body, fits: true });
    expect(texts(short.ink)[0]).toMatchObject({ text: "Three.js BoxGeometry", weight: "bold", fill: UI_INK.title });
    expect(rects(short.ink)[0]).toMatchObject({ fill: UI_INK.panelTop, stroke: UI_INK.panelEdge });

    const longer = cardInk({ text: "word ".repeat(220), width: 900, height: 400 }, measure);
    expect(longer.size).toBeLessThan(UI_TEXT.body);
    expect(longer.size).toBeGreaterThanOrEqual(UI_TEXT.least);

    const far = cardInk({ text: "word ".repeat(2000), width: 900, height: 400 }, measure);
    expect(far).toMatchObject({ size: UI_TEXT.least, fits: false });
    expect(texts(far.ink).at(-1)?.text.endsWith("…")).toBe(true);
    // Never below the card's bottom edge.
    for (const line of texts(far.ink)) expect(line.y).toBeLessThanOrEqual(400 - UI_TEXT.pad + 1);
  });

  it("keeps the writer's paragraphs, and breaks a word too long for any line", () => {
    expect(wrapText(measure, "One line.\n\nAnother paragraph.", 20, 1000)).toEqual(["One line.", "", "Another paragraph."]);
    const lines = wrapText(measure, "see https://saha.ing/s/open.library/~muy0f687-459f516-4046/things/packages/x.zip", 20, 200);
    for (const line of lines) expect(measure(line, 20)).toBeLessThanOrEqual(200);
    expect(lines.join("")).toBe("seehttps://saha.ing/s/open.library/~muy0f687-459f516-4046/things/packages/x.zip");
  });

  it("splits long reading into pages that each fit the card at the menu's text size, every word kept in order", () => {
    const book = Array.from({ length: 60 }, (_, n) => `Paragraph ${n + 1} says something worth reading about a skill.`).join("\n\n");
    const pages = cardPages(measure, book, { width: 1150, height: 990 });
    expect(pages.length).toBeGreaterThan(2);
    for (const page of pages) {
      expect(page.startsWith("\n")).toBe(false);
      const laid = cardInk({ title: "Reader", text: page, width: 1150, height: 990 }, measure);
      expect(laid).toMatchObject({ size: UI_TEXT.body, fits: true });
    }
    expect(pages.join(" ").split(/\s+/).filter(Boolean)).toEqual(book.split(/\s+/).filter(Boolean));
  });
});
