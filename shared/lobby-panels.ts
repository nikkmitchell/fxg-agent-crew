import type { Ink } from "./card-paint.js";
import { fitLines } from "./card-paint.js";
import type { LobbyDoor, Wearable } from "./lobby-hall.js";
import { pageOf } from "./lobby-hall.js";

/**
 * THE LOBBY'S DOORS AND WARDROBE, DRAWN LIKE THE SETTINGS PANEL (Nikk2, 6974):
 * "settings look good for users, but the room selection as well as the avatar
 * selector are still the old ugly UI, can you update those to use the same UI
 * template as we have in personal settings".
 *
 * Both are grids of tiles under tabs (Nikk, 7227), painted in the settings
 * panel's ink on its paper, with its rule that a near miss does nothing. Both are pure here and tested without a renderer; the components draw
 * them and turn presses into calls.
 */

/**
 * THE WELCOME SIGN'S AND THE SETTINGS MENU'S COLOURS (Nikk, 7241: "adjust the Ui look for rooms and the avatar to be
 * the same UI coloring and look as nightjars welcome page (its the same as the settings page)"). The same values as
 * MENU_INK in src/space/menu-paint.ts, which shared code cannot import; change them together.
 */
export const LOBBY_INK = {
  paper: "#1b202c",
  paperHeld: "rgba(255, 255, 255, 0.055)",
  edge: "rgba(255, 255, 255, 0.11)",
  ink: "#eef2fa",
  muted: "#8e99b3",
  accent: "#4d86ff",
  onAccent: "#ffffff",
  rim: "rgba(255, 255, 255, 0.13)",
} as const;

// DOORS ----------------------------------------------------------------------------------------------------------

/**
 * THE DOORS AS THUMBNAILS, TABS ON TOP, LIKE THE WARDROBE (Nikk, 7227): "now it
 * is better looking, but its method is bad, it should still be a bunch of
 * thumbnails, and the tabs should be at the top, like what is done with the
 * avatars". A room has no picture yet, so its tile is a plate in the room's own
 * colour with its initial: the same room is always the same colour, which is
 * what lets a grid be read at a glance.
 */
export const DOOR_PANEL = { width: 1.5, height: 1.72, padding: 0.05, columns: 3, rows: 3, gap: 0.022, bar: 0.11 } as const;
export const DOORS_PER_PAGE = DOOR_PANEL.columns * DOOR_PANEL.rows;

export type DoorTab = "finished" | "work";

const action = (door: LobbyDoor) =>
  door.kind === "here" ? "you are here" : door.kind === "join" ? "join" : door.kind === "space" ? "visit" : "enter";

/** Muted plates that read under the room's light and theme alike, white initials on each. */
const DOOR_COLOURS = ["#5b6f8f", "#8a5a6e", "#4f7d6b", "#9a6b3f", "#6d5a8f", "#3f7a8c", "#8c4f45", "#5f7f3e"];
/** The same room is always the same colour. */
export const doorColour = (room: string): string => {
  let h = 0;
  for (const c of room.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return DOOR_COLOURS[h % DOOR_COLOURS.length];
};

export type DoorTile = { door: LobbyDoor; index: number; x: number; y: number; width: number; height: number; here: boolean; going: boolean };
export type DoorLayout = {
  width: number;
  height: number;
  heading: { y: number; height: number; text: string };
  tabs: { id: string; label: string; selected: boolean; x: number; y: number; width: number; height: number }[];
  tiles: DoorTile[];
  pager: { y: number; height: number; page: number; pages: number; less: Box; more: Box } | null;
  refresh: Box;
  note: string | null;
};

/**
 * Ids: `tab:finished`, `tab:work`, `door:<index into the shown page>`, `page:less`, `page:more`, `refresh`.
 * `going` is the room a door is opening to, shown on its tile.
 */
export function layOutDoors(
  split: { finished: readonly LobbyDoor[]; work: readonly LobbyDoor[] },
  tab: DoorTab,
  page: number,
  loading: boolean,
  going: string | null = null,
): DoorLayout {
  const P = DOOR_PANEL;
  const doors = tab === "finished" ? split.finished : split.work;
  const shown = pageOf(doors, DOORS_PER_PAGE, page);
  const left = -P.width / 2 + P.padding;
  const inner = P.width - P.padding * 2;
  let y = P.height / 2 - P.padding;
  const heading = { y: y - P.bar / 2, height: P.bar, text: loading ? "Rooms · finding them…" : "Rooms · tap one to go" };
  y -= P.bar + P.gap;
  const tabWidth = (inner - P.gap) / 2;
  const tabs = [
    { id: "tab:finished", label: `Finished spaces · ${split.finished.length}`, selected: tab === "finished" },
    { id: "tab:work", label: `Work rooms · ${split.work.length}`, selected: tab === "work" },
  ].map((t, i) => ({ ...t, x: left + tabWidth / 2 + i * (tabWidth + P.gap), y: y - P.bar / 2, width: tabWidth, height: P.bar }));
  y -= P.bar + P.gap;
  const pagerY = -P.height / 2 + P.padding + P.bar / 2;
  const gridBottom = -P.height / 2 + P.padding + P.bar + P.gap;
  const tileWidth = (inner - P.gap * (P.columns - 1)) / P.columns;
  const tileHeight = (y - gridBottom - P.gap * (P.rows - 1)) / P.rows;
  const tiles = shown.items.map((door, index) => {
    const column = index % P.columns, row = Math.floor(index / P.columns);
    return {
      door, index,
      x: left + tileWidth / 2 + column * (tileWidth + P.gap),
      y: y - tileHeight / 2 - row * (tileHeight + P.gap),
      width: tileWidth, height: tileHeight,
      here: door.kind === "here",
      going: going !== null && door.room === going,
    };
  });
  const stepWidth = inner * 0.14;
  const refreshWidth = inner * 0.3;
  const pager = shown.pages > 1
    ? {
      y: pagerY, height: P.bar, page: shown.page, pages: shown.pages,
      less: { x: left + stepWidth / 2, y: pagerY, width: stepWidth, height: P.bar },
      more: { x: left + stepWidth * 1.5 + P.gap, y: pagerY, width: stepWidth, height: P.bar },
    }
    : null;
  const refresh = { x: left + inner - refreshWidth / 2, y: pagerY, width: refreshWidth, height: P.bar };
  const note = !loading && doors.length === 0
    ? tab === "finished" ? "Nothing has been published as a finished space yet." : "No rooms yet."
    : null;
  return { width: P.width, height: P.height, heading, tabs, tiles, pager, refresh, note };
}

/** Which control is under a point, in uv. Exact: a near miss does nothing. */
export function doorsAt(layout: DoorLayout, uv: { x: number; y: number }): string | null {
  const p = { x: (uv.x - 0.5) * layout.width, y: (uv.y - 0.5) * layout.height };
  const inside = (b: Box) => Math.abs(p.x - b.x) <= b.width / 2 && Math.abs(p.y - b.y) <= b.height / 2;
  for (const t of layout.tabs) if (inside(t)) return t.id;
  for (const t of layout.tiles) if (inside(t)) return `door:${t.index}`;
  if (layout.pager) {
    if (inside(layout.pager.less)) return "page:less";
    if (inside(layout.pager.more)) return "page:more";
  }
  if (inside(layout.refresh)) return "refresh";
  return null;
}

export function doorPixels(): { width: number; height: number } {
  return { width: 1024, height: Math.round((1024 * DOOR_PANEL.height) / DOOR_PANEL.width) };
}

export function paintDoors(layout: DoorLayout, measure: (text: string, size: number) => number): PanelInk[] {
  const px = doorPixels();
  const scale = px.width / layout.width;
  const toPx = (b: Box) => ({
    x: (b.x - b.width / 2 + layout.width / 2) * scale,
    y: (layout.height / 2 - (b.y + b.height / 2)) * scale,
    width: b.width * scale,
    height: b.height * scale,
  });
  // The welcome sign's panel: dark, with a faint light rim.
  const ink: PanelInk[] = [
    { kind: "rect", x: 0, y: 0, width: px.width, height: px.height, fill: LOBBY_INK.rim, radius: 22 },
    { kind: "rect", x: 2, y: 2, width: px.width - 4, height: px.height - 4, fill: LOBBY_INK.paper, radius: 20 },
  ];
  const padPx = DOOR_PANEL.padding * scale;
  const head = toPx({ x: 0, y: layout.heading.y, width: layout.width, height: layout.heading.height });
  ink.push({ kind: "text", x: padPx, y: head.y + head.height * 0.72, text: layout.heading.text.toUpperCase(), size: 22, fill: LOBBY_INK.muted, weight: "bold" });
  for (const t of layout.tabs) {
    const b = toPx(t);
    ink.push({ kind: "rect", x: b.x, y: b.y + 3, width: b.width, height: b.height - 6, fill: t.selected ? LOBBY_INK.accent : LOBBY_INK.paperHeld, radius: 10 });
    ink.push({ kind: "text", x: b.x + 18, y: b.y + b.height * 0.64, text: t.label, size: 26, fill: t.selected ? LOBBY_INK.onAccent : LOBBY_INK.ink, weight: t.selected ? "bold" : undefined });
  }
  for (const tile of layout.tiles) {
    const b = toPx(tile);
    const name = tile.door.label ?? tile.door.room;
    const textHeight = 70;
    if (tile.here) ink.push({ kind: "rect", x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4, fill: LOBBY_INK.accent, radius: 12 });
    ink.push({ kind: "rect", x: b.x + 4, y: b.y + 4, width: b.width - 8, height: b.height - 8, fill: LOBBY_INK.paperHeld, radius: 9 });
    const plate = { x: b.x + 8, y: b.y + 8, width: b.width - 16, height: b.height - 16 - textHeight };
    ink.push({ kind: "rect", ...plate, fill: doorColour(tile.door.room), radius: 6 });
    const initial = (name.match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase();
    ink.push({ kind: "text", x: plate.x + plate.width / 2, y: plate.y + plate.height * 0.68, text: initial, size: Math.round(plate.height * 0.55), fill: "#ffffff", weight: "bold", align: "center" });
    const [line] = fitLines(measure, name, 24, b.width - 20, 1);
    ink.push({ kind: "text", x: b.x + b.width / 2, y: b.y + b.height - 42, text: line ?? "", size: 24, fill: tile.here ? LOBBY_INK.accent : LOBBY_INK.ink, weight: "bold", align: "center" });
    const [sub] = fitLines(measure, tile.going ? "opening…" : [action(tile.door), tile.door.detail].filter(Boolean).join(" · "), 19, b.width - 20, 1);
    ink.push({ kind: "text", x: b.x + b.width / 2, y: b.y + b.height - 14, text: sub ?? "", size: 19, fill: LOBBY_INK.muted, align: "center" });
  }
  if (layout.note) {
    const top = toPx({ x: 0, y: layout.tabs[0].y - layout.tabs[0].height, width: layout.width, height: 0.1 });
    for (const line of fitLines(measure, layout.note, 24, px.width - padPx * 2, 2)) {
      ink.push({ kind: "text", x: padPx, y: top.y + 40, text: line, size: 24, fill: LOBBY_INK.muted });
    }
  }
  if (layout.pager) {
    for (const [glyph, box] of [["‹", layout.pager.less], ["›", layout.pager.more]] as const) {
      const b = toPx(box);
      ink.push({ kind: "rect", x: b.x + 3, y: b.y + 3, width: b.width - 6, height: b.height - 6, fill: LOBBY_INK.edge, radius: 8 });
      ink.push({ kind: "text", x: b.x + b.width / 2, y: b.y + b.height * 0.68, text: glyph, size: 34, fill: LOBBY_INK.ink, weight: "bold", align: "center" });
    }
    const after = toPx(layout.pager.more);
    ink.push({ kind: "text", x: after.x + after.width + 16, y: after.y + after.height * 0.64, text: `${layout.pager.page + 1} of ${layout.pager.pages}`, size: 24, fill: LOBBY_INK.muted, weight: "bold" });
  }
  const r = toPx(layout.refresh);
  ink.push({ kind: "rect", x: r.x + 3, y: r.y + 3, width: r.width - 6, height: r.height - 6, fill: LOBBY_INK.edge, radius: 8 });
  ink.push({ kind: "text", x: r.x + r.width / 2, y: r.y + r.height * 0.64, text: "Look again", size: 22, fill: LOBBY_INK.ink, weight: "bold", align: "center" });
  return ink;
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
  // The welcome sign's panel: dark, with a faint light rim.
  const ink: PanelInk[] = [
    { kind: "rect", x: 0, y: 0, width: px.width, height: px.height, fill: LOBBY_INK.rim, radius: 22 },
    { kind: "rect", x: 2, y: 2, width: px.width - 4, height: px.height - 4, fill: LOBBY_INK.paper, radius: 20 },
  ];
  const padPx = WARDROBE_PANEL.padding * scale;
  const head = toPx({ x: 0, y: layout.heading.y, width: layout.width, height: layout.heading.height });
  ink.push({ kind: "text", x: padPx, y: head.y + head.height * 0.72, text: layout.heading.text.toUpperCase(), size: 22, fill: LOBBY_INK.muted, weight: "bold" });
  for (const t of layout.tabs) {
    const b = toPx(t);
    ink.push({ kind: "rect", x: b.x, y: b.y + 3, width: b.width, height: b.height - 6, fill: t.selected ? LOBBY_INK.accent : LOBBY_INK.paperHeld, radius: 10 });
    ink.push({ kind: "text", x: b.x + 18, y: b.y + b.height * 0.64, text: t.label, size: 26, fill: t.selected ? LOBBY_INK.onAccent : LOBBY_INK.ink, weight: t.selected ? "bold" : undefined });
  }
  for (const tile of layout.tiles) {
    const b = toPx(tile);
    const nameHeight = 34;
    if (tile.worn) ink.push({ kind: "rect", x: b.x - 2, y: b.y - 2, width: b.width + 4, height: b.height + 4, fill: LOBBY_INK.accent, radius: 12 });
    ink.push({ kind: "rect", x: b.x + 4, y: b.y + 4, width: b.width - 8, height: b.height - 8, fill: LOBBY_INK.paperHeld, radius: 9 });
    const picture = { x: b.x + 8, y: b.y + 8, width: b.width - 16, height: b.height - 16 - nameHeight };
    if (tile.body.pictured) ink.push({ kind: "image", key: tile.body.key, ...picture });
    else ink.push({ kind: "rect", ...picture, fill: LOBBY_INK.edge, radius: 6 });
    const [name] = fitLines(measure, tile.busy ? "…" : tile.body.name, 22, b.width - 20, 1);
    ink.push({
      kind: "text", x: b.x + b.width / 2, y: b.y + b.height - 14, text: name ?? "", size: 22,
      fill: tile.worn ? LOBBY_INK.accent : LOBBY_INK.ink, weight: tile.worn ? "bold" : undefined, align: "center",
    });
  }
  if (layout.note) {
    const top = toPx({ x: 0, y: layout.tabs[0].y - layout.tabs[0].height, width: layout.width, height: 0.1 });
    for (const line of fitLines(measure, layout.note, 24, px.width - padPx * 2, 2)) {
      ink.push({ kind: "text", x: padPx, y: top.y + 40, text: line, size: 24, fill: LOBBY_INK.muted });
    }
  }
  if (layout.pager) {
    for (const [glyph, box] of [["‹", layout.pager.less], ["›", layout.pager.more]] as const) {
      const b = toPx(box);
      ink.push({ kind: "rect", x: b.x + 3, y: b.y + 3, width: b.width - 6, height: b.height - 6, fill: LOBBY_INK.edge, radius: 8 });
      ink.push({ kind: "text", x: b.x + b.width / 2, y: b.y + b.height * 0.68, text: glyph, size: 34, fill: LOBBY_INK.ink, weight: "bold", align: "center" });
    }
    const mid = toPx({ x: 0, y: layout.pager.y, width: 0, height: layout.pager.height });
    ink.push({ kind: "text", x: px.width / 2, y: mid.y + mid.height * 0.64, text: `${layout.pager.page + 1} of ${layout.pager.pages}`, size: 24, fill: LOBBY_INK.muted, weight: "bold", align: "center" });
  }
  return ink;
}

/** Ink, plus a picture by key and centred text, which the wardrobe needs and the cards do not. */
export type PanelInk =
  | Exclude<Ink, { kind: "text" }>
  | (Omit<Extract<Ink, { kind: "text" }>, "align"> & { align?: "left" | "right" | "center" })
  | { kind: "image"; key: string; x: number; y: number; width: number; height: number };
