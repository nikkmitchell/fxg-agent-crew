import type { GoClock } from "./go-clock.js";
export const GO_SIZES = [5, 9, 13, 19, 25] as const;
export type GoSize = (typeof GO_SIZES)[number];

export const GO_COLOURS = [
  "#15171b", "#f4efe2", "#d85b4b", "#4d8bd6", "#e0ad3b", "#6ead68", "#a66bd4", "#de79a8",
] as const;

/**
 * What the board is made of. Nikk: "can we allow for changing board types
 * inside the settings" — after Baiwei's grey carved-stone idea. Saved on the
 * table, so everyone round it sees the same board. The first is the default,
 * and what every table made before this was.
 */
export const GO_SURFACES = ["bamboo", "stone", "rock"] as const;
export type GoSurface = (typeof GO_SURFACES)[number];

export function isGoSurface(value: unknown): value is GoSurface {
  return typeof value === "string" && (GO_SURFACES as readonly string[]).includes(value);
}

/** The next board type along, going round: there is no "biggest" material. */
export function stepGoSurface(surface: GoSurface, by: number): GoSurface {
  const count = GO_SURFACES.length;
  const index = GO_SURFACES.indexOf(surface);
  return GO_SURFACES[(((index + by) % count) + count) % count];
}

export type GoStone = { x: number; y: number; colour: number; id?: string };
export type GoCapture = GoStone & { by: number };
export type GoRoomItem = {
  id: string;
  kind: "go";
  size: GoSize;
  colours: string[];
  activeColour: number;
  liftedColour: number | null;
  stones: GoStone[];
  captures: GoCapture[];
  revision: number;
  carrier: { by: string; hand: "left" | "right" | null } | null;
  position: { x: number; y: number; z: number; rotationY: number };
  scale: number;
  deskVisible: boolean;
  surface: GoSurface;
  /**
   * Passes in a row. Nikk (4504): "the game ends when both players pass". Any
   * stone played puts it back to 0; when every seated colour has passed in turn,
   * the game is over. See shared/go-score.ts for how it is then counted.
   */
  passes: number;
  /** Everybody passed: no more stones until the board is cleared. */
  ended: boolean;
  /** Show whose territory is whose during play, not only once the game ends. */
  territoryShown: boolean;
  /** The point closed by ko for the next move only; null when none. See go-rules. */
  ko: { x: number; y: number } | null;
  /** The game clock, or null when the table plays untimed. See go-clock. */
  clock: GoClock | null;
  /** The colour that ran out of time, which ended the game; else null. */
  timedOut: number | null;
};
/**
 * A THING FROM A SPACE'S GIT, LIVE IN THE ROOM (Nikk, 2026-10-01). Three
 * kinds of thing are written as modules in a space's repo and listed in its
 * saha-pieces.json (shared/space-bench.ts), and any of them can be brought
 * into a room:
 *
 *   - an ITEM (a butterfly, an instrument, a video panel): stands where it is
 *     put, and is moved like the Go table;
 *   - an ENVIRONMENT (a forest, a nightclub, a theatre): all around the room,
 *     in place of the room's own scenery;
 *   - a SPACE (items, an environment and the scripts that tie them together):
 *     either all around you, full size, or a model on the table to work on.
 *
 * The module's code runs in the room's own page (src/space/modules), given the
 * room's scene, camera and renderer. Which file and export is read from the
 * space's manifest each time it loads, so a push reloads it for everyone.
 */
export type ModuleRole = "item" | "environment" | "space";
export const MODULE_ROLES: readonly ModuleRole[] = ["item", "environment", "space"];
export type ModuleView = "placed" | "full";
export type ModuleRoomItem = {
  id: string;
  kind: "module";
  revision: number;
  /** Where its code comes from: a space, the branch followed, and the manifest entry's id. */
  source: { space: string; branch: string; entry: string };
  name: string;
  role: ModuleRole;
  /** placed: stands where it was put and can be moved. full: all around the room, in place of its scenery. */
  view: ModuleView;
  position: { x: number; y: number; z: number; rotationY: number };
  scale: number;
  addedBy: string;
};

/** How big a placed thing may be made: a space as a model is small; an item about its own size. */
export const MODULE_SCALE = { min: 0.01, max: 5, model: 0.05 } as const;

export type RoomItem = GoRoomItem | ModuleRoomItem;

export const isGoItem = (item: RoomItem): item is GoRoomItem => item.kind === "go";
export const isModuleItem = (item: RoomItem): item is ModuleRoomItem => item.kind === "module";

/** Only an environment, or a space at full size, takes the room's place; a room has one at a time. */
export const isFullView = (item: RoomItem): item is ModuleRoomItem => item.kind === "module" && item.view === "full";

const ENTRY = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SPACE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function parseModuleItem(value: unknown): ModuleRoomItem | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<ModuleRoomItem>;
  const source = item.source;
  if (item.kind !== "module" || typeof item.id !== "string" || !source || typeof source !== "object") return null;
  if (typeof source.space !== "string" || !SPACE.test(source.space) || typeof source.branch !== "string" || !BRANCH.test(source.branch)) return null;
  if (typeof source.entry !== "string" || !ENTRY.test(source.entry)) return null;
  if (!MODULE_ROLES.includes(item.role as ModuleRole) || (item.view !== "placed" && item.view !== "full")) return null;
  const position = item.position;
  if (!position || ![position.x, position.y, position.z, position.rotationY].every(Number.isFinite)) return null;
  const scale = typeof item.scale === "number" && Number.isFinite(item.scale) ? Math.min(MODULE_SCALE.max, Math.max(MODULE_SCALE.min, item.scale)) : 1;
  return {
    id: item.id,
    kind: "module",
    revision: Number.isInteger(item.revision) ? item.revision! : 0,
    source: { space: source.space, branch: source.branch, entry: source.entry },
    name: typeof item.name === "string" && item.name ? item.name.slice(0, 60) : source.entry,
    role: item.role as ModuleRole,
    view: item.view,
    position: { x: position.x, y: position.y, z: position.z, rotationY: position.rotationY },
    scale,
    addedBy: typeof item.addedBy === "string" ? item.addedBy : "",
  };
}

export function isGoSize(value: unknown): value is GoSize {
  return typeof value === "number" && (GO_SIZES as readonly number[]).includes(value);
}

/**
 * How many people can be round one board.
 *
 * Two is a game of Go. More is what the room is actually for — Nikk asked for
 * "number of players" as a setting, and every extra player is one more bowl
 * colour, so the ceiling is however many colours there are to tell them apart
 * by. A ninth player would be given a colour somebody already has, which is
 * worse than not having a ninth player.
 */
export const GO_PLAYERS = { min: 2, max: GO_COLOURS.length } as const;

/** The next board size up or down, stopping at the ends rather than wrapping. */
export function stepGoSize(size: GoSize, by: number): GoSize {
  const index = GO_SIZES.indexOf(size);
  const next = Math.min(GO_SIZES.length - 1, Math.max(0, index + by));
  return GO_SIZES[next];
}

export function defaultGoItem(id: string, ordinal = 0): GoRoomItem {
  return {
    id,
    kind: "go",
    size: 9,
    colours: [...GO_COLOURS.slice(0, 2)],
    activeColour: 0,
    liftedColour: null,
    stones: [],
    captures: [], revision: 0, carrier: null, scale: 1, deskVisible: true, surface: GO_SURFACES[0],
    passes: 0, ended: false, territoryShown: false, ko: null, clock: null, timedOut: null,
    position: { x: ordinal * 2.65 - 1.15, y: 0, z: 1.8, rotationY: 0 },
  };
}

export function parseRoomItem(value: unknown): RoomItem | null {
  if (!value || typeof value !== "object") return null;
  if ((value as { kind?: unknown }).kind === "module") return parseModuleItem(value);
  const item = value as Partial<GoRoomItem>;
  if (item.kind !== "go" || typeof item.id !== "string" || !isGoSize(item.size)) return null;
  if (!Array.isArray(item.colours) || item.colours.length < 2 || item.colours.length > GO_COLOURS.length) return null;
  if (!item.colours.every((colour) => typeof colour === "string")) return null;
  if (!Number.isInteger(item.activeColour) || item.activeColour! < 0 || item.activeColour! >= item.colours.length) return null;
  const lifted = item.liftedColour;
  if (lifted !== null && (!Number.isInteger(lifted) || lifted! < 0 || lifted! >= item.colours.length)) return null;
  if (!Array.isArray(item.stones)) return null;
  const stones = item.stones.filter((stone): stone is GoStone =>
    Boolean(stone) && Number.isInteger(stone.x) && Number.isInteger(stone.y) &&
    Number.isInteger(stone.colour) && stone.x >= 0 && stone.y >= 0 &&
    stone.x < item.size! && stone.y < item.size! && stone.colour >= 0 && stone.colour < item.colours!.length,
  );
  if (stones.length !== item.stones.length || !item.position ||
      ![item.position.x, item.position.z, item.position.rotationY].every(Number.isFinite)) return null;
  // Upgrade old tables without clearing their game.
  return { ...item, captures: item.captures ?? [], revision: item.revision ?? 0,
    carrier: item.carrier ?? null, scale: item.scale ?? 1, deskVisible: item.deskVisible ?? true,
    surface: isGoSurface(item.surface) ? item.surface : GO_SURFACES[0],
    passes: Number.isInteger(item.passes) && item.passes! >= 0 ? item.passes : 0,
    ended: item.ended === true, territoryShown: item.territoryShown === true,
    ko: item.ko && Number.isInteger(item.ko.x) && Number.isInteger(item.ko.y) ? { x: item.ko.x, y: item.ko.y } : null,
    clock: item.clock && Number.isFinite(item.clock.perMove) && Array.isArray(item.clock.bank) && Number.isFinite(item.clock.turnStartedAt)
      ? { perMove: item.clock.perMove, bank: item.clock.bank.map(Number), turnStartedAt: item.clock.turnStartedAt } : null,
    timedOut: Number.isInteger(item.timedOut) ? item.timedOut : null,
    position: { ...item.position, y: item.position.y ?? 0 } } as GoRoomItem;
}

/**
 * THE CLIENT'S TABLES NEVER GO BACKWARDS.
 *
 * Nikk, in a headset: "all the go board settings don't do anything when I open
 * the settings and then click on things... that menu doesn't seem to actually
 * change anything". The server's log said otherwise: fifteen changes arrived,
 * four succeeded and eleven were refused 409, "The table changed. Try again."
 *
 * The headset's socket was reconnecting every half minute or so, and a table's
 * new state reached the client ONLY by that socket. So one success moved the
 * table's revision on, the headset never heard, and every later press carried
 * the old revision and was refused — and a refusal broadcasts nothing, so the
 * headset stayed stale until the socket happened to reconnect. From inside the
 * headset: press, nothing; press, nothing.
 *
 * The answer to a change already carries the table as it now is. Applying it
 * the moment it arrives makes the table's freshness independent of the socket,
 * which is the part of this that the network gets to break.
 */
export function withFresher(items: RoomItem[], incoming: RoomItem): RoomItem[] {
  const at = items.findIndex((item) => item.id === incoming.id);
  if (at < 0) return [...items, incoming];
  if ((items[at].revision ?? 0) > (incoming.revision ?? 0)) return items;
  const next = items.slice();
  next[at] = incoming;
  return next;
}

/**
 * A whole list from the socket, merged without letting any table go backwards.
 *
 * The answer to a change and the socket's broadcast travel on different
 * connections, so an older broadcast can land AFTER a newer answer has already
 * been applied. Taken at face value it would roll the table back a step — and
 * the next press would be refused for being out of date. Tables missing from
 * the list are gone, and go.
 */
export function mergeRoomItems(current: RoomItem[], incoming: RoomItem[]): RoomItem[] {
  const known = new Map(current.map((item) => [item.id, item]));
  return incoming.map((item) => {
    const mine = known.get(item.id);
    return mine && (mine.revision ?? 0) > (item.revision ?? 0) ? mine : item;
  });
}
