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
export const GO_SURFACES = ["bamboo", "stone"] as const;
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
};
export type RoomItem = GoRoomItem;

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
    passes: 0, ended: false, territoryShown: false,
    position: { x: ordinal * 2.65 - 1.15, y: 0, z: 1.8, rotationY: 0 },
  };
}

export function parseRoomItem(value: unknown): RoomItem | null {
  if (!value || typeof value !== "object") return null;
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
