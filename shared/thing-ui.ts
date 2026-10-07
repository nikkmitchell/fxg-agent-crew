import type { Ink } from "./card-paint.js";
import { UI_INK } from "./ui-ink.js";

/**
 * A THING'S CONTROLS AND TEXT IN THE PLATFORM'S LOOK (ctx.ui, src/engine/ui.ts;
 * Mica 7331, Baiwei 7333: the Library's plaques and the settings menu were two
 * looks). What a button or a card shows, as drawing instructions rather than
 * pixels (shared/card-paint.ts says why), so a test can read what a part says
 * and where without a canvas.
 *
 * THE SETTINGS MENU'S OWN TERMS: its palette (shared/ui-ink.ts), its font, and
 * its density, 900 canvas pixels to the metre (src/space/menu-layout.ts, MENU),
 * so text the same size in metres looks the same in both.
 *
 * A BUTTON STANDS ON ITS OWN GLASS. In the menu a pill sits on the menu's dark
 * card; a thing's button sits on a shelf or in front of passthrough, where a
 * pill of 11% white would vanish. So each button carries its own piece of the
 * dark glass, and over it the menu's own fills: the control's, lighter under a
 * pointer, the accent when pressed.
 */

export const UI_PX_PER_METRE = 900;
/** The longest side of one part's canvas. A bigger part is drawn coarser rather than uploaded bigger. */
export const UI_MAX_PX = 2048;

export const UI_TEXT = {
  /** Body text at full density: the menu's row text (28 px at 900 px/m, about 3 cm). */
  body: 28,
  /** Smallest body text a card shrinks to before it cuts the end off. */
  least: 20,
  title: 34,
  /** A button's label, as a share of its height. */
  label: 0.4,
  pad: 30,
  radius: 46,
  /** Line height, as a multiple of the text size. */
  leading: 1.3,
} as const;

export type UiTone = "normal" | "accent" | "danger";
export type UiState = "rest" | "hover" | "pressed" | "disabled";
export type Measure = (text: string, size: number) => number;

/** Canvas pixels for a part this many metres across, and the scale its text is drawn at (below 1 only when capped). */
export function uiPixels(width: number, height: number): { width: number; height: number; scale: number } {
  const scale = Math.min(1, UI_MAX_PX / Math.max(width * UI_PX_PER_METRE, height * UI_PX_PER_METRE, 1));
  return {
    width: Math.max(8, Math.round(width * UI_PX_PER_METRE * scale)),
    height: Math.max(8, Math.round(height * UI_PX_PER_METRE * scale)),
    scale,
  };
}

/** The words cut with an ellipsis until they fit `width`. */
export function fitOne(measure: Measure, text: string, size: number, width: number): string {
  if (measure(text, size) <= width) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, mid).trimEnd()}…`, size) <= width) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low).trimEnd()}…` : "…";
}

/**
 * Lines that fit `width`, keeping the writer's own line breaks: a blank line
 * stays a blank line, so paragraphs read as paragraphs. A word longer than the
 * line is cut where it must be rather than run off the edge.
 */
export function wrapText(measure: Measure, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (let word of words) {
      while (measure(word, size) > width && word.length > 1) {
        // A long token (a URL, a hash): as much as fits, then the rest on the next line.
        let take = word.length - 1;
        while (take > 1 && measure(word.slice(0, take), size) > width) take -= 1;
        if (line) lines.push(line);
        lines.push(word.slice(0, take));
        line = "";
        word = word.slice(take);
      }
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate, size) <= width || !line) line = candidate;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const BUTTON_FILL: Record<UiTone, Record<Exclude<UiState, "disabled">, string>> = {
  normal: { rest: UI_INK.control, hover: UI_INK.controlHover, pressed: UI_INK.accent },
  danger: { rest: UI_INK.control, hover: UI_INK.controlHover, pressed: UI_INK.danger },
  accent: { rest: UI_INK.accent, hover: UI_INK.accentHover, pressed: UI_INK.accentDeep },
};

/** A button: its own glass, the menu's fill for its state, and its label in the middle. */
export function buttonInk(
  part: { label: string; tone?: UiTone; state: UiState; width: number; height: number; scale?: number },
  measure: Measure,
): Ink[] {
  const { width, height } = part;
  const tone = part.tone ?? "normal";
  const radius = height / 2;
  const glass: Ink = { kind: "rect", x: 1, y: 1, width: width - 2, height: height - 2, radius, fill: UI_INK.panelTop, stroke: UI_INK.panelEdge, lineWidth: 2 };
  const fill = part.state === "disabled" ? UI_INK.card : BUTTON_FILL[tone][part.state];
  const over: Ink = { kind: "rect", x: 1, y: 1, width: width - 2, height: height - 2, radius, fill };
  const size = Math.max(10, Math.round(height * UI_TEXT.label));
  const words =
    part.state === "disabled" ? UI_INK.faint
      : part.state === "pressed" || tone === "accent" ? UI_INK.onAccent
        : tone === "danger" ? UI_INK.danger
          : UI_INK.text;
  const label = fitOne(measure, part.label, size, width - radius * 1.2);
  return [glass, over, { kind: "text", x: width / 2, y: height / 2 + size * 0.36, text: label, size, fill: words, weight: "bold", align: "center" }];
}

/** Where a card's body goes, for a card of these pixels: what `cardInk` and `cardPages` agree on. */
function bodyBox(width: number, height: number, scale: number, title: boolean): { x: number; top: number; width: number; height: number } {
  const pad = UI_TEXT.pad * scale;
  const titleRoom = title ? UI_TEXT.title * scale * UI_TEXT.leading + pad * 0.4 : 0;
  return { x: pad, top: pad + titleRoom, width: Math.max(1, width - pad * 2), height: Math.max(1, height - pad * 2 - titleRoom) };
}

/**
 * A card: the menu's dark glass with its hairline edge, a title, and the text
 * at the largest size from the menu's row text down to `least` at which all of
 * it fits. If it cannot fit even then, the last line ends in an ellipsis and
 * `fits` says so (use ctx.ui.pages for long reading).
 */
export function cardInk(
  part: { title?: string; text: string; width: number; height: number; scale?: number },
  measure: Measure,
  /** The title is drawn bold, so it is measured bold. */
  measureBold: Measure = measure,
): { ink: Ink[]; size: number; fits: boolean } {
  const scale = part.scale ?? 1;
  const { width, height } = part;
  const ink: Ink[] = [
    { kind: "rect", x: 1, y: 1, width: width - 2, height: height - 2, radius: Math.min(UI_TEXT.radius * scale, height / 4, width / 4), fill: UI_INK.panelTop, stroke: UI_INK.panelEdge, lineWidth: 2 },
  ];
  const pad = UI_TEXT.pad * scale;
  const title = part.title?.trim();
  if (title) {
    const size = UI_TEXT.title * scale;
    ink.push({ kind: "text", x: pad, y: pad + size, text: fitOne(measureBold, title, size, width - pad * 2), size, fill: UI_INK.title, weight: "bold" });
  }
  const box = bodyBox(width, height, scale, Boolean(title));
  let size = UI_TEXT.body * scale;
  let lines = wrapText(measure, part.text, size, box.width);
  while (lines.length * size * UI_TEXT.leading > box.height && size > UI_TEXT.least * scale) {
    size = Math.max(UI_TEXT.least * scale, size - 2 * scale);
    lines = wrapText(measure, part.text, size, box.width);
  }
  const room = Math.max(1, Math.floor(box.height / (size * UI_TEXT.leading)));
  const fits = lines.length <= room;
  if (!fits) {
    lines = lines.slice(0, room);
    lines[room - 1] = fitOne(measure, `${lines[room - 1]}…`, size, box.width);
  }
  lines.forEach((line, index) => {
    if (line) ink.push({ kind: "text", x: box.x, y: box.top + size + index * size * UI_TEXT.leading, text: line, size, fill: UI_INK.soft });
  });
  return { ink, size, fits };
}

/**
 * Long text as pages that each fit a card of this size at the menu's row text
 * size: the reader's pages, so a page of a book and a card are the same words
 * the same size. Paragraph breaks are kept; a page never starts on a blank line.
 */
export function cardPages(measure: Measure, text: string, part: { width: number; height: number; title?: boolean; scale?: number }): string[] {
  const scale = part.scale ?? 1;
  const box = bodyBox(part.width, part.height, scale, part.title !== false);
  const size = UI_TEXT.body * scale;
  const per = Math.max(1, Math.floor(box.height / (size * UI_TEXT.leading)));
  const lines = wrapText(measure, text, size, box.width);
  const pages: string[] = [];
  let at = 0;
  while (at < lines.length) {
    while (at < lines.length && lines[at] === "") at += 1;
    if (at >= lines.length) break;
    pages.push(lines.slice(at, at + per).join("\n").replace(/\n+$/, ""));
    at += per;
  }
  return pages.length ? pages : [""];
}
