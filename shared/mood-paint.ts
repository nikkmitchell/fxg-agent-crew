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

/**
 * The bitmap a note is drawn into, SHAPED LIKE THE NOTE.
 *
 * Mood items are whatever shape their owner dragged them to — a tall column of
 * text, a wide strip, a square swatch. A fixed canvas stretched every one of
 * them to 16:9, and a stretched texture reads as blurring rather than as a
 * mistake. Same rule as the settings panel, same rule `label-aspect.test.ts`
 * has stated all along.
 *
 * The longer side is fixed so text is a predictable size; the other follows.
 */
export const NOTE_LONG_SIDE = 512;

export function notePixels(item: { w: number; h: number }): { width: number; height: number } {
  const w = Math.max(item.w, 1);
  const h = Math.max(item.h, 1);
  return w >= h
    ? { width: NOTE_LONG_SIDE, height: Math.max(1, Math.round((NOTE_LONG_SIDE * h) / w)) }
    : { width: Math.max(1, Math.round((NOTE_LONG_SIDE * w) / h)), height: NOTE_LONG_SIDE };
}

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
  const { width, height } = notePixels(item);
  // Text sized to the bitmap rather than to a constant, so a small note is not
  // drawn with letters bigger than itself.
  const body = Math.max(16, Math.round(height * 0.12));
  const pad = Math.max(12, Math.round(width * 0.055));
  const text = (item.text ?? "").trim();

  if (item.kind === "swatch" && looksLikeColour(text)) {
    const colour = text.startsWith("#") ? text : `#${text}`;
    return [
      { kind: "rect", x: 0, y: 0, width, height, fill: colour, radius: 16 },
      {
        kind: "text",
        x: pad,
        y: height - Math.round(pad * 0.9),
        text: colour.toUpperCase(),
        size: body,
        fill: readableInk(colour),
        weight: "bold",
      },
    ];
  }

  const ink: Ink[] = [
    { kind: "rect", x: 0, y: 0, width, height, fill: CARD_INK.paper, radius: 16 },
    { kind: "line", x: 0, y: 0, width, height: Math.max(4, Math.round(height * 0.028)), fill: item.kind === "link" ? CARD_INK.accent : CARD_INK.edge },
  ];
  const lineHeight = Math.round(body * 1.3);
  const firstLine = Math.round(pad + body * 1.4);

  if (!text) {
    ink.push({ kind: "text", x: pad, y: firstLine, text: "empty", size: body, fill: CARD_INK.muted });
    return ink;
  }

  // How many lines fit, worked out rather than assumed, so a short wide strip
  // does not try to draw five rows of text into one row of space.
  const room = Math.max(1, Math.floor((height - firstLine - pad) / lineHeight) + 1);
  let y = firstLine;
  for (const line of fitLines(measure, text, body, width - pad * 2, room)) {
    ink.push({
      kind: "text",
      x: pad,
      y,
      text: line,
      size: body,
      fill: item.kind === "link" ? CARD_INK.accent : CARD_INK.ink,
    });
    y += lineHeight;
  }

  if (item.addedBy && y < height - pad) {
    ink.push({ kind: "text", x: pad, y: height - Math.round(pad * 0.6), text: item.addedBy, size: Math.round(body * 0.7), fill: CARD_INK.muted });
  }
  return ink;
}
