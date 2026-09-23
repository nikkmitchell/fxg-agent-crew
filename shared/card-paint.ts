import type { BoardCard } from "./board-3d.js";

/**
 * What a card looks like, as instructions rather than pixels.
 *
 * ONE DESCRIPTION, TWO CONSUMERS, and that is the reason this is not simply a
 * function that draws on a canvas. The room paints these to a texture; a test
 * has no canvas at all. Returning a list of things to draw lets the test assert
 * what a card SAYS and where, and lets the painter stay four lines of
 * boilerplate that cannot really be wrong.
 *
 * It also stops a card looking like two things. There is one description, so
 * the desktop and a headset cannot drift into different cards — which is the
 * whole point of the one-room work, applied to the smallest unit of it.
 */

export type Ink =
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill: string; radius?: number }
  | {
      kind: "text";
      /** The anchor. With `align: "right"` this is the text's RIGHT edge, not its left. */
      x: number;
      y: number;
      text: string;
      size: number;
      fill: string;
      weight?: "normal" | "bold";
      align?: "left" | "right";
    }
  | { kind: "line"; x: number; y: number; width: number; height: number; fill: string };

/** Measured in card-local pixels, origin top-left — canvas's own convention. */
export const CARD_PX = { width: 512, height: 256 } as const;

/**
 * The colours, named once.
 *
 * TAKEN FROM THE SITE'S OWN TOKENS rather than picked afresh, because a card in
 * the room that is a different grey from a card on the page is a card that
 * looks like a different product. If these drift from styles.css, that is a bug
 * and not a preference.
 */
export const CARD_INK = {
  paper: "#faf8f2",
  paperHeld: "#fffdf5",
  edge: "#d9d3c4",
  ink: "#222321",
  muted: "#6b6559",
  accent: "#e45338",
  refused: "#b23b22",
} as const;

/** A status's stripe, so a card is recognisable without reading it. */
export const STATUS_STRIPE: Record<string, string> = {
  backlog: "#9a9486",
  assigned: "#5b7fa6",
  in_progress: "#c98a2b",
  blocked: "#b23b22",
  review: "#7a5ea8",
  done: "#4f8a5b",
};

export type CardMood = "resting" | "held" | "refused";

/**
 * Break a string into lines that fit, using whatever can measure text.
 *
 * The measurer is passed in for the same reason `chat-texture.wrap` does it: a
 * test can supply one that counts characters, and then this is testable without
 * a canvas. A card whose title silently overflows its own edge is a card you
 * cannot read, and that is worth a test.
 */
export function fitLines(
  measure: (text: string, size: number) => number,
  text: string,
  size: number,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate, size) <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && line) lines.push(line);

  // ELIDED, NOT CUT OFF MID-WORD. A title that just stops reads as data loss;
  // an ellipsis reads as "there is more", which is true and is what the detail
  // panel is for.
  if (lines.length === maxLines) {
    const used = lines.slice(0, maxLines).join(" ").split(/\s+/).length;
    if (used < words.length) {
      let last = lines[maxLines - 1];
      while (last && measure(`${last}…`, size) > maxWidth) {
        last = last.split(" ").slice(0, -1).join(" ");
      }
      lines[maxLines - 1] = `${last}…`;
    }
  }
  return lines;
}

/**
 * Everything to draw for one card.
 *
 * MOOD IS A PARAMETER, NOT A SECOND FUNCTION. A held card and a refused card
 * are the same card wearing a different face; giving each its own painter is
 * how they end up disagreeing about where the title goes.
 */
export function paintCard(
  card: BoardCard,
  measure: (text: string, size: number) => number,
  mood: CardMood = "resting",
): Ink[] {
  const { width, height } = CARD_PX;
  const pad = 26;
  const stripe = 12;
  const ink: Ink[] = [
    {
      kind: "rect",
      x: 0,
      y: 0,
      width,
      height,
      fill: mood === "held" ? CARD_INK.paperHeld : CARD_INK.paper,
      radius: 18,
    },
    { kind: "line", x: 0, y: 0, width: stripe, height, fill: STATUS_STRIPE[card.status] ?? CARD_INK.edge },
  ];

  // A refused card is outlined in the refusal colour while it is in the air, so
  // the answer arrives before the drop rather than after it.
  if (mood === "refused") {
    ink.push({ kind: "rect", x: 0, y: 0, width, height: 6, fill: CARD_INK.refused });
    ink.push({ kind: "rect", x: 0, y: height - 6, width, height: 6, fill: CARD_INK.refused });
  }

  const titleSize = 34;
  const lines = fitLines(measure, card.title, titleSize, width - stripe - pad * 2, 3);
  lines.forEach((line, index) => {
    ink.push({
      kind: "text",
      x: stripe + pad,
      y: pad + titleSize + index * (titleSize + 8),
      text: line,
      size: titleSize,
      fill: CARD_INK.ink,
      weight: "bold",
    });
  });

  // The footer: who has it, and whether anyone has said anything. Both are
  // omitted when absent rather than shown as "none" — an empty line is quieter
  // than a word meaning nothing.
  const footer: string[] = [];
  if (card.assigneeId) footer.push(card.assigneeId);
  if (card.commentCount) footer.push(`${card.commentCount} comment${card.commentCount === 1 ? "" : "s"}`);
  if (footer.length) {
    ink.push({
      kind: "text",
      x: stripe + pad,
      y: height - pad,
      text: footer.join("  ·  "),
      size: 24,
      fill: CARD_INK.muted,
    });
  }
  return ink;
}
