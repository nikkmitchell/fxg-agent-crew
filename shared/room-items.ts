export const GO_SIZES = [5, 9, 13, 19, 25] as const;
export type GoSize = (typeof GO_SIZES)[number];

export const GO_COLOURS = [
  "#15171b", "#f4efe2", "#d85b4b", "#4d8bd6", "#e0ad3b", "#6ead68", "#a66bd4", "#de79a8",
] as const;

export const GO_STYLES = ["patient", "tactical", "experimental", "casual", "observer"] as const;
export type GoStyle = (typeof GO_STYLES)[number];
export const GO_RISKS = ["cautious", "balanced", "bold"] as const;
export type GoRisk = (typeof GO_RISKS)[number];
export type GoPlayCard = { style: GoStyle; risk: GoRisk; signature: string };

export type GoStone = { x: number; y: number; colour: number };
export type GoMode = "open" | "seated";
export type GoScore = { area: number[]; komi: number[]; totals: number[]; winner: number | null };
export type GoRoomItem = {
  id: string;
  kind: "go";
  size: GoSize;
  colours: string[];
  activeColour: number;
  liftedColour: number | null;
  /** Open mode grants only the current move to the first actor who lifts the active stone. */
  turnActor: string | null;
  /** Open: no lasting color ownership. Seated: players claim a persistent bowl/color. */
  mode: GoMode;
  stones: GoStone[];
  /** Public seat ownership; personal play preferences are stored separately. */
  seats: Array<string | null>;
  previousPosition: string | null;
  moveNumber: number;
  consecutivePasses: number;
  gameOver: boolean;
  score: GoScore | null;
  position: { x: number; z: number; rotationY: number };
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
    turnActor: null,
    mode: "open",
    stones: [],
    seats: [null, null],
    previousPosition: null,
    moveNumber: 0,
    consecutivePasses: 0,
    gameOver: false,
    score: null,
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
  // Existing saved tables predate modes and were seat-only; preserve their behavior.
  const mode = item.mode ?? "seated";
  const turnActor = item.turnActor ?? null;
  const score = item.score ?? null;
  if ((mode !== "open" && mode !== "seated") ||
      (turnActor !== null && (typeof turnActor !== "string" || turnActor.length === 0 || turnActor.length > 128)) ||
      (score !== null && (!Array.isArray(score.area) || !Array.isArray(score.komi) || !Array.isArray(score.totals) ||
        score.area.length !== item.colours.length || score.komi.length !== item.colours.length || score.totals.length !== item.colours.length ||
        ![...score.area, ...score.komi, ...score.totals].every(Number.isFinite) ||
        (score.winner !== null && (!Number.isInteger(score.winner) || score.winner < 0 || score.winner >= item.colours.length))))) return null;
  if (!Array.isArray(item.stones)) return null;
  const stones = item.stones.filter((stone): stone is GoStone =>
    Boolean(stone) && Number.isInteger(stone.x) && Number.isInteger(stone.y) &&
    Number.isInteger(stone.colour) && stone.x >= 0 && stone.y >= 0 &&
    stone.x < item.size! && stone.y < item.size! && stone.colour >= 0 && stone.colour < item.colours!.length,
  );
  const seats = item.seats ?? item.colours.map(() => null);
  const previousPosition = item.previousPosition ?? null;
  const moveNumber = item.moveNumber ?? stones.length;
  const consecutivePasses = item.consecutivePasses ?? 0;
  const gameOver = item.gameOver ?? false;
  if (!Array.isArray(seats) || seats.length !== item.colours.length ||
      !seats.every((seat) => seat === null || (typeof seat === "string" && seat.length > 0 && seat.length <= 128)) ||
      new Set(seats.filter((seat): seat is string => seat !== null).map((seat) => seat.toLocaleLowerCase("en-US"))).size !== seats.filter((seat) => seat !== null).length ||
      (previousPosition !== null && (typeof previousPosition !== "string" || previousPosition.length !== item.size * item.size || !/^[.A-H]+$/.test(previousPosition))) ||
      !Number.isInteger(moveNumber) || moveNumber < 0 ||
      !Number.isInteger(consecutivePasses) || consecutivePasses < 0 ||
      typeof gameOver !== "boolean") return null;
  if (stones.length !== item.stones.length || new Set(stones.map((stone) => `${stone.x},${stone.y}`)).size !== stones.length || !item.position ||
      ![item.position.x, item.position.z, item.position.rotationY].every(Number.isFinite)) return null;
  return { ...item, mode, turnActor, score, seats, previousPosition, moveNumber, consecutivePasses, gameOver } as GoRoomItem;
}
