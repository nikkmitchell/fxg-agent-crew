import type { Ink } from "./card-paint.js";
import { CARD_INK, fitLines } from "./card-paint.js";
import type { MoodItem } from "./mood-3d.js";

/**
 * Everything on a mood board that is not a picture.
 *
 * NOTES, SWATCHES AND LINKS, each drawn as itself. They used to arrive as part
 * of a screenshot of the website; drawn here they are as sharp as the panel.
 *
 * A SWATCH IS A COLOUR, not its own hex printed as a line of text — the website
 * learned that the hard way and the note in `MoodBoard.tsx` says so. The value
 * stays readable on top, in ink chosen against the colour rather than guessed,
 * so it works on a pale yellow and on a navy alike.
 */

export const NOTE_PX = { width: 512, height: 288 } as const;

/** Black or white, whichever can be read on this background. */
export function readableInk(hex: string): string {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  // Rec. 709 luma: green carries most of the perceived brightness.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? "#121212" : "#f6f4ee";
}

const looksLikeColour = (text: string) => /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(text.trim());

export function paintNote(item: MoodItem, measure: (text: string, size: number) => number): Ink[] {
  const { width, height } = NOTE_PX;
  const text = (item.text ?? "").trim();

  if (item.kind === "swatch" && looksLikeColour(text)) {
    const colour = text.startsWith("#") ? text : `#${text}`;
    return [
      { kind: "rect", x: 0, y: 0, width, height, fill: colour, radius: 16 },
      {
        kind: "text",
        x: 24,
        y: height - 28,
        text: colour.toUpperCase(),
        size: 34,
        fill: readableInk(colour),
        weight: "bold",
      },
    ];
  }

  const ink: Ink[] = [
    { kind: "rect", x: 0, y: 0, width, height, fill: CARD_INK.paper, radius: 16 },
    { kind: "line", x: 0, y: 0, width, height: 8, fill: item.kind === "link" ? CARD_INK.accent : CARD_INK.edge },
  ];

  if (!text) {
    ink.push({ kind: "text", x: 28, y: 76, text: "empty", size: 30, fill: CARD_INK.muted });
    return ink;
  }

  let y = 76;
  for (const line of fitLines(measure, text, 34, width - 56, 5)) {
    ink.push({
      kind: "text",
      x: 28,
      y,
      text: line,
      size: 34,
      fill: item.kind === "link" ? CARD_INK.accent : CARD_INK.ink,
    });
    y += 44;
  }

  if (item.addedBy) {
    ink.push({ kind: "text", x: 28, y: height - 24, text: item.addedBy, size: 22, fill: CARD_INK.muted });
  }
  return ink;
}
