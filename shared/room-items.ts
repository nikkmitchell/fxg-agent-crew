export const GO_SIZES = [5, 9, 13, 19, 25] as const;
export type GoSize = (typeof GO_SIZES)[number];

export const GO_COLOURS = [
  "#15171b", "#f4efe2", "#d85b4b", "#4d8bd6", "#e0ad3b", "#6ead68", "#a66bd4", "#de79a8",
] as const;

export type GoStone = { x: number; y: number; colour: number };
export type GoRoomItem = {
  id: string;
  kind: "go";
  size: GoSize;
  colours: string[];
  activeColour: number;
  liftedColour: number | null;
  stones: GoStone[];
  position: { x: number; z: number; rotationY: number };
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

/**
 * How close to the edge of the room a table may be pushed.
 *
 * Smaller than a panel's margin: a panel has to be READ from a distance, and a
 * table has to be REACHED, so a table against a wall is fine as long as there
 * is room to stand at it.
 */
const TABLE_EDGE = 1.2;

/**
 * Whether a table may stand here, in the same words the room uses elsewhere.
 *
 * SHARED, so a drag is refused where it happens rather than travelling to the
 * server to be undone a moment later — the rule panels already follow.
 */
export function tableRefusal(position: { x: number; z: number }, room = { width: 20, depth: 22 }): string | null {
  if (!Number.isFinite(position.x) || !Number.isFinite(position.z)) return "that position is not a number";
  if (Math.abs(position.x) > room.width / 2 - TABLE_EDGE || Math.abs(position.z) > room.depth / 2 - TABLE_EDGE) {
    return "that is outside the room; nobody would be able to stand at it";
  }
  return null;
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
    position: { x: ordinal * 2.35 - 1.15, z: 1.8, rotationY: 0 },
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
  return item as GoRoomItem;
}
