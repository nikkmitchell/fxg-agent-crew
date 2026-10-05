import type { Ink } from "./card-paint.js";
import { CARD_INK, fitLines } from "./card-paint.js";
import type { LobbyDoor, Wearable } from "./lobby-hall.js";
import { pageOf } from "./lobby-hall.js";
import { SETTINGS, type SettingsItem, type SettingsSize } from "./settings-3d.js";

/**
 * THE LOBBY'S DOORS AND WARDROBE, DRAWN LIKE THE SETTINGS PANEL (Nikk2, 6974):
 * "settings look good for users, but the room selection as well as the avatar
 * selector are still the old ugly UI, can you update those to use the same UI
 * template as we have in personal settings".
 *
 * The doors are settings rows, so they ARE the settings panel: the same paper,
 * plates, accent and exact hit-testing (shared/settings-3d.ts). The wardrobe
 * needs pictures, which rows cannot hold, so it is a grid of tiles painted in
 * the same ink on the same paper, with the same rule that a near miss does
 * nothing. Both are pure here and tested without a renderer; the components draw
 * them and turn presses into calls.
 */

// DOORS ----------------------------------------------------------------------------------------------------------

export const DOOR_PANEL: SettingsSize = { ...SETTINGS, width: 1.5, height: 1.72 };
/** How many doors fit under the heading, the two tabs and the pager at that size. */
export const DOORS_PER_PAGE = 6;

export type DoorTab = "finished" | "work";

const action = (door: LobbyDoor) =>
  door.kind === "here" ? "you are here" : door.kind === "join" ? "join" : door.kind === "space" ? "visit" : "enter";

/**
 * The rows of the doors panel. Ids: `tab:finished`, `tab:work`, `door:<index into the shown list>`,
 * `page:less` / `page:more`, `refresh`.
 */
export function doorItems(
  split: { finished: readonly LobbyDoor[]; work: readonly LobbyDoor[] },
  tab: DoorTab,
  page: number,
  loading: boolean,
): { items: SettingsItem[]; shown: LobbyDoor[]; page: number; pages: number } {
  const doors = tab === "finished" ? split.finished : split.work;
  const shown = pageOf(doors, DOORS_PER_PAGE, page);
  const items: SettingsItem[] = [
    { kind: "heading", label: loading ? "Rooms · finding them…" : "Rooms · tap one to go" },
    { kind: "choice", id: "tab:finished", label: `Finished spaces · ${split.finished.length}`, selected: tab === "finished" },
    { kind: "choice", id: "tab:work", label: `Work rooms · ${split.work.length}`, selected: tab === "work" },
  ];
  if (!loading && doors.length === 0) {
    items.push({ kind: "note", label: tab === "finished" ? "Nothing has been published as a finished space yet." : "No rooms yet." });
  }
  shown.items.forEach((door, index) => {
    const name = door.label ?? door.room;
    const detail = door.detail ? ` · ${door.detail}` : "";
    // The room you stand in is the chosen one, in the accent; every other door says what pressing it does.
    if (door.kind === "here") items.push({ kind: "choice", id: `door:${index}`, label: `${name} · you are here`, selected: true });
    else items.push({ kind: "cycle", id: `door:${index}`, label: `${name}${detail}`, value: action(door) });
  });
  for (let i = shown.items.length; i < DOORS_PER_PAGE && doors.length > DOORS_PER_PAGE; i += 1) {
    items.push({ kind: "note", label: "" }); // keep the pager where it was on a short last page
  }
  if (shown.pages > 1) items.push({ kind: "stepper", id: "page", label: "Page", value: `${shown.page + 1} of ${shown.pages}` });
  items.push({ kind: "cycle", id: "refresh", label: "Look again for rooms", value: "refresh" });
  return { items, shown: shown.items, page: shown.page, pages: shown.pages };
}

// WARDROBE -------------------------------------------------------------------------------------------------------

export type WardrobeTab = "public" | "ai";

export const WARDROBE_PANEL = { width: 1.2, height: 1.72, padding: 0.05, columns: 4, rows: 3, gap: 0.022, bar: 0.11 } as const;
export const BODIES_PER_PAGE = WARDROBE_PANEL.columns * WARDROBE_PANEL.rows;

export type WardrobeTile = { body: Wearable; x: number; y: number; width: number; height: number; worn: boolean; busy: boolean };
export type WardrobeLayout = {
  width: number;
  height: number;
  heading: { y: number; height: number; text: string };
  tabs: { id: string; label: string; selected: boolean; x: number; y: number; width: number; height: number }[];
  tiles: WardrobeTile[];
  pager: { y: number; height: number; page: number; pages: number; less: Box; more: Box } | null;
  note: string | null;
};
type Box = { x: number; y: number; width: number; height: number };

/** Ids: `tab:public`, `tab:ai`, `wear:<body key>`, `page:less`, `page:more`. */
export function layOutWardrobe(
  bodies: readonly Wearable[] | null,
  tab: WardrobeTab,
  page: number,
  worn: string | null,
  busy: string | null,
): WardrobeLayout {
  const P = WARDROBE_PANEL;
  const all = bodies ?? [];
  const publicBodies = all.filter((b) => !b.ai);
  const aiBodies = all.filter((b) => b.ai);
  const list = tab === "ai" ? aiBodies : publicBodies;
  const shown = pageOf(list, BODIES_PER_PAGE, page);
  const left = -P.width / 2 + P.padding;
  const inner = P.width - P.padding * 2;
  let y = P.height / 2 - P.padding;

  const heading = { y: y - P.bar / 2, height: P.bar, text: bodies === null ? "Your avatar · loading…" : "Your avatar · tap one to wear it" };
  y -= P.bar + P.gap;
  const tabWidth = (inner - P.gap) / 2;
  const tabs = [
    { id: "tab:public", label: `Public · ${publicBodies.length}`, selected: tab === "public" },
    { id: "tab:ai", label: `AI made · ${aiBodies.length}`, selected: tab === "ai" },
  ].map((t, i) => ({ ...t, x: left + tabWidth / 2 + i * (tabWidth + P.gap), y: y - P.bar / 2, width: tabWidth, height: P.bar }));
  y -= P.bar + P.gap;

  const pagerHeight = P.bar;
  const gridBottom = -P.height / 2 + P.padding + pagerHeight + P.gap;
  const tileWidth = (inner - P.gap * (P.columns - 1)) / P.columns;
  const tileHeight = (y - gridBottom - P.gap * (P.rows - 1)) / P.rows;
  const tiles = shown.items.map((body, i) => {
    const column = i % P.columns, row = Math.floor(i / P.columns);
    return {
      body,
      x: left + tileWidth / 2 + column * (tileWidth + P.gap),
      y: y - tileHeight / 2 - row * (tileHeight + P.gap),
      width: tileWidth,
      height: tileHeight,
      worn: body.key === worn,
      busy: body.key === busy,
    };
  });
  const pagerY = -P.height / 2 + P.padding + pagerHeight / 2;
  const stepWidth = inner * 0.16;
  const pager = shown.pages > 1
    ? {
      y: pagerY, height: pagerHeight, page: shown.page, pages: shown.pages,
      less: { x: left + stepWidth / 2, y: pagerY, width: stepWidth, height: pagerHeight },
      more: { x: left + inner - stepWidth / 2, y: pagerY, width: stepWidth, height: pagerHeight },
    }
    : null;
  const note = bodies !== null && list.length === 0
    ? tab === "ai" ? "No AI-made bodies yet. The avatar workshop shows how to make one." : "No bodies can be served yet."
    : null;
  return { width: P.width, height: P.height, heading, tabs, tiles, pager, note };
}

/** Which control is under a point, in uv. EXACT, like the settings panel: a near miss does nothing. */
export function wardrobeAt(layout: WardrobeLayout, uv: { x: number; y: number }): string | null {
  const p = { x: (uv.x - 0.5) * layout.width, y: (uv.y - 0.5) * layout.height };
  const inside = (b: Box) => Math.abs(p.x - b.x) <= b.width / 2 && Math.abs(p.y - b.y) <= b.height / 2;
  for (const t of layout.tabs) if (inside(t)) return t.id;
  for (const t of layout.tiles) if (inside(t)) return `wear:${t.body.key}`;
  if (layout.pager) {
    if (inside(layout.pager.less)) return "page:less";
    if (inside(layout.pager.more)) return "page:more";
  }
  return null;
}

/** The wardrobe's bitmap: the settings panel's width in pixels, height following the panel. */
export function wardrobePixels(): { width: number; height: number } {
  return { width: 1024, height: Math.round((1024 * WARDROBE_PANEL.height) / WARDROBE_PANEL.width) };
}

/**
 * The wardrobe's ink. A picture is `{ kind: "image", key }`: the component supplies the loaded thumbnails by key,
 * and a tile whose picture has not arrived shows its name on a plain plate instead.
 */
export function paintWardrobe(layout: WardrobeLayout, measure: (text: string, size: number) => number): PanelInk[] {
  const px = wardrobePixels();
  const scale = px.width / layout.width;
  const toPx = (b: Box) => ({
    x: (b.x - b.width / 2 + layout.width / 2) * scale,
    y: (layout.height / 2 - (b.y + b.height / 2)) * scale,
    width: b.width * scale,
    height: b.height * scale,
  });
  const ink: PanelInk[] = [{ kind: "rect", x: 0, y: 0, width: px.width, height: px.height, fill: CARD_INK.paper, radius: 20 }];
  const padPx = WARDROBE_PANEL.padding * scale;
  const head = toPx({ x: 0, y: layout.heading.y, width: layout.width, height: layout.heading.height });
  ink.push({ kind: "text", x: padPx, y: head.y + head.height * 0.72, text: layout.heading.text.toUpperCase(), size: 22, fill: CARD_INK.muted, weight: "bold" });
  for (const t of layout.tabs) {
    const b = toPx(t);
    ink.push({ kind: "rect", x: b.x, y: b.y + 3, width: b.width, height: b.height - 6, fill: t.selected ? CARD_INK.accent : CARD_INK.paperHeld, radius: 10 });
    ink.push({ kind: "text", x: b.x + 18, y: b.y + b.height * 0.64, text: t.label, size: 26, fill: t.selected ? CARD_INK.paper : CARD_INK.ink, weight: t.selected ? "bold" : undefined });
  }
  for (const tile of layout.tiles) {
    const b = toPx(tile);
    const nameHeight = 34;
    if (tile.worn) ink.push({ kind: "rect", x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4, fill: CARD_INK.accent, radius: 12 });
    ink.push({ kind: "rect", x: b.x + 4, y: b.y + 4, width: b.width - 8, height: b.height - 8, fill: CARD_INK.paperHeld, radius: 9 });
    const picture = { x: b.x + 8, y: b.y + 8, width: b.width - 16, height: b.height - 16 - nameHeight };
    if (tile.body.pictured) ink.push({ kind: "image", key: tile.body.key, ...picture });
    else ink.push({ kind: "rect", ...picture, fill: CARD_INK.edge, radius: 6 });
    const [name] = fitLines(measure, tile.busy ? "…" : tile.body.name, 22, b.width - 20, 1);
    ink.push({
      kind: "text", x: b.x + b.width / 2, y: b.y + b.height - 14, text: name ?? "", size: 22,
      fill: tile.worn ? CARD_INK.accent : CARD_INK.ink, weight: tile.worn ? "bold" : undefined, align: "center",
    });
  }
  if (layout.note) {
    const top = toPx({ x: 0, y: layout.tabs[0].y - layout.tabs[0].height, width: layout.width, height: 0.1 });
    for (const line of fitLines(measure, layout.note, 24, px.width - padPx * 2, 2)) {
      ink.push({ kind: "text", x: padPx, y: top.y + 40, text: line, size: 24, fill: CARD_INK.muted });
    }
  }
  if (layout.pager) {
    for (const [glyph, box] of [["‹", layout.pager.less], ["›", layout.pager.more]] as const) {
      const b = toPx(box);
      ink.push({ kind: "rect", x: b.x + 3, y: b.y + 3, width: b.width - 6, height: b.height - 6, fill: CARD_INK.edge, radius: 8 });
      ink.push({ kind: "text", x: b.x + b.width / 2, y: b.y + b.height * 0.68, text: glyph, size: 34, fill: CARD_INK.ink, weight: "bold", align: "center" });
    }
    const mid = toPx({ x: 0, y: layout.pager.y, width: 0, height: layout.pager.height });
    ink.push({ kind: "text", x: px.width / 2, y: mid.y + mid.height * 0.64, text: `${layout.pager.page + 1} of ${layout.pager.pages}`, size: 24, fill: CARD_INK.muted, weight: "bold", align: "center" });
  }
  return ink;
}

/** Ink, plus a picture by key and centred text, which the wardrobe needs and the cards do not. */
export type PanelInk =
  | Exclude<Ink, { kind: "text" }>
  | (Omit<Extract<Ink, { kind: "text" }>, "align"> & { align?: "left" | "right" | "center" })
  | { kind: "image"; key: string; x: number; y: number; width: number; height: number };
