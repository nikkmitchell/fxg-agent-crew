import type { Ink } from "./card-paint.js";
import { CARD_INK, fitLines } from "./card-paint.js";

/**
 * The room's settings, as a surface rather than a page.
 *
 * WHY THIS EXISTS. Everything here was reachable only from a wrist menu inside
 * a headset — including the one that decides what the whole room is looking at.
 * On a desktop there was no way to change it at all: I seeded a project, opened
 * the room, and found the board empty with no control anywhere that could point
 * it at anything. Nikk asked for this directly: "settings should be available
 * in desktop version so lets do a cleanup and update on settings UI as well".
 *
 * A PANEL, NOT A MENU ON YOUR ARM. A wrist menu needs a wrist. This hangs on
 * the arc with the other panels, is drawn the same way, and is pressed by the
 * same pointer — so it exists in both rooms by construction rather than by
 * being ported twice.
 *
 * PURE, like the board: what the rows ARE, where they sit, and which one is
 * under a finger are decided here and tested without a renderer. The component
 * draws this and turns presses into calls.
 */

export type SettingsItem =
  /** A section title. Not pressable. */
  | { kind: "heading"; label: string }
  /** One of a set; pressing it picks it. */
  | { kind: "choice"; id: string; label: string; selected: boolean }
  /** On or off; pressing it flips it. */
  | { kind: "toggle"; id: string; label: string; on: boolean }
  /** A value with a smaller and a bigger control: `${id}:less` and `${id}:more`. */
  | { kind: "stepper"; id: string; label: string; value: string }
  /** A value that cycles through a short list; pressing it steps once. */
  | { kind: "cycle"; id: string; label: string; value: string }
  /** Something to say when there is nothing to choose. Not pressable. */
  | { kind: "note"; label: string };

/**
 * The proportions a settings panel can be laid out at.
 *
 * A TYPE for the same reason the board has one: `SETTINGS` below is `as const`,
 * so without this its literal `2.2` becomes the only width the layout will
 * accept, and the size argument turns into decoration.
 */
export type SettingsSize = {
  width: number;
  height: number;
  padding: number;
  rowHeight: number;
  rowGap: number;
  headingHeight: number;
  stepperWidth: number;
};

export const SETTINGS = {
  width: 2.2,
  height: 2.4,
  padding: 0.06,
  rowHeight: 0.13,
  rowGap: 0.012,
  headingHeight: 0.11,
  /** The two ends of a stepper, as a fraction of the row's width. */
  stepperWidth: 0.16,
} as const;

/**
 * The bitmap this is drawn into, SHAPED LIKE THE PANEL IT GOES ON.
 *
 * A texture mapped onto a plane of a different aspect is not cropped or
 * letterboxed — it is STRETCHED, and the result reads as blurring rather than
 * as a mistake. This file shipped with a fixed 768x838 bitmap on a 4.0 x 2.5
 * panel, so every word on it was squeezed to about half its proper width. The
 * room already had a test stating this exact rule; it only ever looked at one
 * component, so it did not see this one.
 *
 * Width is fixed for a predictable text size; height follows the panel.
 */
export const SETTINGS_PX_WIDTH = 1024;

export function settingsPixels(layout: { width: number; height: number }): { width: number; height: number } {
  return {
    width: SETTINGS_PX_WIDTH,
    height: Math.round((SETTINGS_PX_WIDTH * layout.height) / layout.width),
  };
}

export type SettingsTarget = {
  /** What to call back with. A stepper yields `${id}:less` / `${id}:more`. */
  id: string;
  /** Panel-local metres, centre. */
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SettingsLayout = {
  width: number;
  height: number;
  /** The items that fitted, in order, with where they were put. */
  rows: { item: SettingsItem; y: number; height: number }[];
  targets: SettingsTarget[];
  /** How many items did not fit. Reported, never silently dropped. */
  hidden: number;
};

/**
 * Stack the items down the panel.
 *
 * NO SCROLLING. A scrolling surface in a room needs a scrollbar, a drag that
 * competes with moving the panel, and a second thing to test — and the drag
 * would fight the one that moves the panel itself. What does not fit is
 * counted and said out loud instead, which is a smaller lie than a list that
 * quietly stops.
 */
export function layOutSettings(items: readonly SettingsItem[], size: SettingsSize = SETTINGS): SettingsLayout {
  const rows: SettingsLayout["rows"] = [];
  const targets: SettingsTarget[] = [];
  const left = -size.width / 2 + size.padding;
  const innerWidth = size.width - size.padding * 2;
  let y = size.height / 2 - size.padding;
  let hidden = 0;

  for (const item of items) {
    const height = item.kind === "heading" ? size.headingHeight : size.rowHeight;
    if (y - height < -size.height / 2 + size.padding) {
      hidden += 1;
      continue;
    }
    const centre = y - height / 2;
    rows.push({ item, y: centre, height });

    if (item.kind === "choice" || item.kind === "toggle" || item.kind === "cycle") {
      targets.push({ id: item.id, x: 0, y: centre, width: innerWidth, height });
    } else if (item.kind === "stepper") {
      const stepWidth = innerWidth * size.stepperWidth;
      targets.push({
        id: `${item.id}:less`,
        x: left + innerWidth - stepWidth * 2 - 0.01 + stepWidth / 2,
        y: centre,
        width: stepWidth,
        height,
      });
      targets.push({
        id: `${item.id}:more`,
        x: left + innerWidth - stepWidth / 2,
        y: centre,
        width: stepWidth,
        height,
      });
    }

    y -= height + size.rowGap;
  }

  return { width: size.width, height: size.height, rows, targets, hidden };
}

/**
 * Which control is under a point, in uv.
 *
 * EXACT, not nearest. Every press here changes something for everybody in the
 * room — what it is showing, whether a panel exists — so a near miss must do
 * nothing rather than do the neighbouring thing.
 */
export function settingAt(layout: SettingsLayout, uv: { x: number; y: number }): string | null {
  const point = { x: (uv.x - 0.5) * layout.width, y: (uv.y - 0.5) * layout.height };
  for (const target of layout.targets) {
    if (
      Math.abs(point.x - target.x) <= target.width / 2 &&
      Math.abs(point.y - target.y) <= target.height / 2
    ) {
      return target.id;
    }
  }
  return null;
}

/** Panel-local metres to the bitmap's pixels, so drawing and hit-testing agree. */
const toPx = (layout: SettingsLayout, px: { width: number; height: number }, x: number, y: number) => ({
  x: (x / layout.width + 0.5) * px.width,
  // v runs up, the canvas runs down.
  y: (0.5 - y / layout.height) * px.height,
});

export function paintSettings(
  layout: SettingsLayout,
  measure: (text: string, size: number) => number,
): Ink[] {
  const px = settingsPixels(layout);
  const ink: Ink[] = [
    { kind: "rect", x: 0, y: 0, width: px.width, height: px.height, fill: CARD_INK.paper, radius: 20 },
  ];
  const scale = px.width / layout.width;
  const padPx = (SETTINGS.padding / layout.width) * px.width;

  for (const row of layout.rows) {
    const { item } = row;
    const top = toPx(layout, px, 0, row.y + row.height / 2).y;
    const heightPx = row.height * scale;

    if (item.kind === "heading") {
      ink.push({
        kind: "text",
        x: padPx,
        y: top + heightPx * 0.72,
        text: item.label.toUpperCase(),
        size: 22,
        fill: CARD_INK.muted,
        weight: "bold",
      });
      continue;
    }

    if (item.kind === "note") {
      for (const line of fitLines(measure, item.label, 22, px.width - padPx * 2, 2)) {
        ink.push({ kind: "text", x: padPx, y: top + heightPx * 0.62, text: line, size: 22, fill: CARD_INK.muted });
      }
      continue;
    }

    /**
     * THE ROW'S OWN PLATE, so it is obvious that a row is a thing you press.
     *
     * ACCENT MEANS "THE ONE", NOT "ON". The first version filled every row that
     * was true — and since the panels are all open by default, the panel opened
     * as a wall of orange bars with the one CHOSEN project no louder than any
     * of them. The accent is now spent only where there is a choice between
     * things; an open panel says so with a quiet mark and its ordinary ink.
     */
    const chosen = item.kind === "choice" && item.selected;
    const on = item.kind === "toggle" && item.on;
    ink.push({
      kind: "rect",
      x: padPx,
      y: top + 3,
      width: px.width - padPx * 2,
      height: heightPx - 6,
      fill: chosen ? CARD_INK.accent : CARD_INK.paperHeld,
      radius: 10,
    });
    if (on) {
      // A tick's worth of accent down the edge: enough to scan, not enough to
      // shout over the row that is actually selected.
      ink.push({ kind: "line", x: padPx, y: top + 3, width: 7, height: heightPx - 6, fill: CARD_INK.accent });
    }
    ink.push({
      kind: "text",
      x: padPx + 18,
      y: top + heightPx * 0.62,
      text: item.label,
      size: 26,
      fill: chosen ? CARD_INK.paper : CARD_INK.ink,
      weight: chosen || on ? "bold" : undefined,
    });

    if (item.kind === "cycle" || item.kind === "stepper") {
      ink.push({
        kind: "text",
        x: px.width - padPx - (item.kind === "stepper" ? 108 : 18),
        y: top + heightPx * 0.62,
        text: item.value,
        size: 24,
        fill: CARD_INK.muted,
        weight: "bold",
      });
    }
    if (item.kind === "stepper") {
      for (const [glyph, target] of [["−", `${item.id}:less`], ["+", `${item.id}:more`]] as const) {
        const box = layout.targets.find((t) => t.id === target);
        if (!box) continue;
        const centre = toPx(layout, px, box.x, box.y);
        ink.push({
          kind: "rect",
          x: centre.x - (box.width * scale) / 2 + 3,
          y: top + 3,
          width: box.width * scale - 6,
          height: heightPx - 6,
          fill: CARD_INK.edge,
          radius: 8,
        });
        ink.push({ kind: "text", x: centre.x - 7, y: top + heightPx * 0.64, text: glyph, size: 28, fill: CARD_INK.ink, weight: "bold" });
      }
    }
  }

  if (layout.hidden > 0) {
    ink.push({
      kind: "text",
      x: padPx,
      y: px.height - 16,
      text: `${layout.hidden} more, not shown`,
      size: 20,
      fill: CARD_INK.muted,
    });
  }

  return ink;
}
