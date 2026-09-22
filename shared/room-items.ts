export const GO_SIZES = [5, 9, 13, 19, 25] as const;
export type GoSize = (typeof GO_SIZES)[number];

export const GO_COLOURS = [
  "#15171b", "#f4efe2", "#d85b4b", "#4d8bd6", "#e0ad3b", "#6ead68", "#a66bd4", "#de79a8",
] as const;

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
};
export type RoomItem = GoRoomItem;

export function isGoSize(value: unknown): value is GoSize {
  return typeof value === "number" && (GO_SIZES as readonly number[]).includes(value);
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
    captures: [], revision: 0, carrier: null, scale: 1, deskVisible: true,
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
    position: { ...item.position, y: item.position.y ?? 0 } } as GoRoomItem;
}
