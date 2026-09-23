import { GO_PLAYERS, GO_SIZES, stepGoSize, type GoRoomItem, type GoSize } from "../../shared/room-items";
import { SETTINGS, layOutSettings, type SettingsItem, type SettingsSize } from "../../shared/settings-3d";

/**
 * What the Go table's own settings panel says, and what pressing a row does.
 *
 * WHY IT IS THE TABLE'S OWN. Nikk: "make the settings for board grid size and
 * number of players to be a settings button on the go board, so add a little
 * settings icon on the go board, and when you click that you can adjust the
 * settings of the go board, as well as reset it and so on" — and, about what
 * was there before, "(now go board movement settings are just buttons which is
 * super weird)".
 *
 * They were in a list on the side of the room: a row per board size, per table,
 * in a menu you reached by walking away from the table. The settings for a
 * thing belong on the thing.
 *
 * PURE, so what the rows say and what each press means are decided here and
 * checked without a renderer — the same split as the room's own settings.
 */

/**
 * A panel sized for a table rather than for a wall.
 *
 * Small enough to sit above a table without hiding the board under it, and
 * checked by a test that no row falls off the bottom: the room's own settings
 * panel silently drops what does not fit and says "4 more, not shown", which is
 * honest and still means a setting nobody can reach.
 */
export const GO_PANEL: SettingsSize = { ...SETTINGS, width: 1.6, height: 1.0 };

/**
 * The board's own geometry, in the numbers the table is drawn from.
 *
 * Here rather than in the component because the gear has to be placed CLEAR of
 * it, and that is arithmetic worth checking rather than eyeballing — see
 * `gearClearance` below.
 */
export const BOARD = {
  /** How far across the playing grid runs, corner intersection to corner intersection. */
  extent: 1.22,
  /** Half the wooden top. */
  halfTop: 0.74,
} as const;

/** The gap between intersections, and how big each one's hit target is. */
export function boardStep(size: GoSize): number {
  return BOARD.extent / (size - 1);
}
export function stoneTargetRadius(size: GoSize): number {
  return Math.max(0.025, boardStep(size) * 0.38);
}

/**
 * WHERE THE GEAR SITS, and why it is out past the corner.
 *
 * I put it on the tabletop first and it did not work — the press went to an
 * invisible stone target instead and came back 409 "lift the glowing stone
 * first", which the room swallows, so the gear looked simply dead. The stone
 * targets are round, they are centred ON the outermost intersections, and they
 * are drawn ABOVE the gear, so they reach past the edge of the grid by their
 * own radius and take every ray aimed near the corner.
 *
 * The worst case is the SMALLEST board: 5×5 has the widest spacing, so its
 * targets are the biggest — a radius of 0.116 reaching out to 0.726, nearly
 * the edge of the wood. Sized for 19×19 this would have looked fine and broken
 * the moment anybody chose a small board.
 *
 * So the gear stands out past the corner on a short stalk, diagonally, where
 * the nearest stone target is a quarter of a metre away at every board size.
 */
export const GEAR = { out: 0.84, y: 0.92, radius: 0.09 } as const;

/**
 * How much clear air there is between the gear and the nearest stone target.
 *
 * Positive means they cannot both be under the same ray. Asserted for every
 * board size there is.
 */
export function gearClearance(size: GoSize): number {
  const corner = BOARD.extent / 2;
  const between = Math.hypot(GEAR.out - corner, GEAR.out - corner);
  return between - stoneTargetRadius(size) - GEAR.radius;
}

export function goSettingsItems(item: GoRoomItem): SettingsItem[] {
  return [
    { kind: "heading", label: "Go table" },
    { kind: "stepper", id: "go:size", label: "Board", value: `${item.size}×${item.size}` },
    { kind: "stepper", id: "go:players", label: "Players", value: `${item.colours.length}` },
    { kind: "choice", id: "go:reset", label: "Clear the stones", selected: false },
    { kind: "choice", id: "go:close", label: "Done", selected: false },
  ];
}

/** What a press on the table's settings means. `null` for a row that does nothing here. */
export type GoSettingChange =
  | { kind: "size"; size: GoSize }
  | { kind: "players"; players: number }
  | { kind: "reset" }
  | { kind: "close" }
  /** Pressed a limit — say so rather than doing nothing silently. */
  | { kind: "refused"; why: string };

export function goSettingFor(item: GoRoomItem, id: string): GoSettingChange | null {
  if (id === "go:close") return { kind: "close" };
  if (id === "go:reset") return { kind: "reset" };

  if (id === "go:size:less" || id === "go:size:more") {
    const size = stepGoSize(item.size, id.endsWith(":more") ? 1 : -1);
    if (size === item.size) {
      return {
        kind: "refused",
        why: id.endsWith(":more")
          ? `${GO_SIZES[GO_SIZES.length - 1]}×${GO_SIZES[GO_SIZES.length - 1]} is the biggest board there is`
          : `${GO_SIZES[0]}×${GO_SIZES[0]} is the smallest board there is`,
      };
    }
    return { kind: "size", size };
  }

  if (id === "go:players:less" || id === "go:players:more") {
    const now = item.colours.length;
    const players = now + (id.endsWith(":more") ? 1 : -1);
    if (players > GO_PLAYERS.max) return { kind: "refused", why: `${GO_PLAYERS.max} is as many bowl colours as there are` };
    if (players < GO_PLAYERS.min) return { kind: "refused", why: "a board needs two players" };
    return { kind: "players", players };
  }

  return null;
}

/**
 * A warning worth giving before it happens.
 *
 * Changing the size clears the board, and so does removing a player who has
 * stones down. Both are the kind of thing somebody presses once by accident
 * and cannot undo.
 */
export function goSettingCost(item: GoRoomItem, change: GoSettingChange): string | null {
  if (change.kind === "size" && item.stones.length > 0) return "this clears the board";
  if (change.kind === "players" && change.players < item.colours.length) {
    const losing = item.stones.filter((stone) => stone.colour >= change.players).length;
    if (losing > 0) return `this takes ${losing} stone${losing === 1 ? "" : "s"} off`;
  }
  return null;
}

/** Whether every row fits on the table's panel, which a test asserts. */
export function goSettingsFit(item: GoRoomItem): boolean {
  return layOutSettings(goSettingsItems(item), GO_PANEL).hidden === 0;
}
