import { GO_PLAYERS, GO_SIZES, stepGoSize, type GoRoomItem, type GoSize } from "../../shared/room-items";
import { GO_SURFACE, goBoardWidth, goBowl, goPoint, goExtent, GO_PITCH } from "../../shared/go-layout";
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
 * BUILT ON MORAINE'S TABLE, not my own. We redesigned this at the same time
 * without knowing; their version shipped first and is better — constant pitch,
 * captures, trays, carrying, a revision for concurrency — so the geometry here
 * reads from `shared/go-layout.ts` rather than from numbers of mine. What is
 * left of mine is the part they did not build: this panel, and `players` and
 * `reset` on the server.
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
export const GO_PANEL: SettingsSize = { ...SETTINGS, width: 1.6, height: 1.25 };

/**
 * WHERE THE GEAR SITS, and why it floats rather than lying on the deck.
 *
 * MY FIRST ONE DID NOT WORK, and I only know because I clicked it. It lay on
 * the tabletop, and the press went to an invisible stone target drawn above it
 * and came back 409 "lift the glowing stone first" — which the room swallows,
 * so the gear looked simply dead. No error, nothing in the console.
 *
 * Laying it flat somewhere else only moves the problem. The deck is crowded and
 * gets more crowded as the table grows: the board widens with every size, and
 * the bowls and trays sit on a SQUARE perimeter, so the corners — the obvious
 * empty spot on a small two-player table — are exactly where the diagonal
 * stations land once there are six or eight players. I checked every size
 * against every seating and the diagonal only clears at the very edge of the
 * deck, two metres out from the middle of a 25×25.
 *
 * So it stands ABOVE the near edge instead. Everything you can touch on this
 * table lives in a thin slab around the surface — stone targets stop at
 * GO_SURFACE + 0.085 and bowls at GO_SURFACE + 0.09 — so a gear held a clear
 * head above them cannot be confused with any of them at any size or seating,
 * and the clearance is vertical, which no amount of widening the board eats
 * into.
 */
export const GEAR = {
  /** Above every touch volume on the table, with room to spare. */
  y: GO_SURFACE + 0.3,
  radius: 0.075,
  /** How far in front of the board's near edge it stands. */
  ahead: 0.1,
} as const;

/** Where the gear stands, in the table's own frame: at the right-hand end of the grab bar. */
export function gearAt(item: { size: GoSize }): { x: number; y: number; z: number } {
  return {
    x: barWidth(item.size) / 2 + GEAR.radius + 0.05,
    y: GEAR.y,
    z: goBoardWidth(item.size) / 2 + GEAR.ahead,
  };
}

/**
 * The smallest gap between the gear and anything else on this table that takes
 * a press.
 *
 * Positive means no ray and no fingertip can mean both. Asserted across every
 * board size and every seating, because the crowding depends on both.
 */
export function gearClearance(size: GoSize, colours: number): number {
  const gear = gearAt({ size });
  let worst = Infinity;

  // Stone targets: a disc at each intersection, reaching up to +0.085.
  const stoneTop = GO_SURFACE + 0.085;
  const stoneReach = GO_PITCH * 0.43;
  const half = goExtent(size) / 2;
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j < size; j += 1) {
      const flat = Math.hypot(gear.x - goPoint(i, size), gear.z - goPoint(j, size));
      const over = gear.y - stoneTop;
      // Outside the disc horizontally OR above it vertically is clear; the
      // separation is whichever gives more room.
      worst = Math.min(worst, Math.max(flat - stoneReach, over) - GEAR.radius);
    }
  }

  // Bowls: reachable within 0.19 across, and up to +0.09 above the surface.
  for (let index = 0; index < colours; index += 1) {
    const bowl = goBowl(index, colours, size);
    const flat = Math.hypot(gear.x - bowl.x, gear.z - bowl.z);
    const over = gear.y - (bowl.y + 0.15);
    worst = Math.min(worst, Math.max(flat - 0.19, over) - GEAR.radius);
  }

  return worst;
}

/**
 * THE BAR YOU PICK THE TABLE UP BY.
 *
 * Three handles failed before this one, and each failed the same way: it was
 * the right size in metres and too small for a pointer.
 *
 *   - The board's own RIM. Twice I aimed at a rim I could see on screen and
 *     the press fell through to the look-drag, swinging the room instead of
 *     moving the table. A rim seen edge-on is a few pixels.
 *   - A fat invisible COLLAR around and below the board. A test killed it
 *     before it shipped: at 5×5 it reached 4.5cm into the bowls' own reach,
 *     and lowering it under them put it beneath the desk top, where the desk
 *     — which has no handler at all — would have taken every ray first.
 *
 * So the handle is a BAR, in the air in front of the board, beside the gear and
 * at the same height. That is the shape Nikk asked for in the first place —
 * "you grab a window and drag it" — and it is exactly what the room's panels
 * already do, which have carried a bar along their top edge from the start.
 *
 * Its clearance is VERTICAL, like the gear's: everything else on this table
 * lives in a thin slab around the surface, so a handle held a head above them
 * cannot be confused with any of them at any size or seating.
 */
export const BAR = {
  /** Half the width of the board, within sensible bounds, so it scales with the table. */
  minWidth: 0.44,
  maxWidth: 0.9,
  thickness: 0.055,
} as const;

export function barWidth(size: GoSize): number {
  return Math.min(BAR.maxWidth, Math.max(BAR.minWidth, goBoardWidth(size) * 0.55));
}

/** Where the grab bar sits, in the table's own frame. */
export function barAt(size: GoSize): { x: number; y: number; z: number } {
  return { x: 0, y: GEAR.y, z: goBoardWidth(size) / 2 + GEAR.ahead };
}

/**
 * How far the bar and the gear stand clear of everything pressable below them.
 *
 * One number, because they share a height and that height is the whole
 * argument. Positive means no ray aimed at a stone or a bowl can reach either.
 */
export function handleClearance(size: GoSize, colours: number): number {
  const bar = barAt(size);
  const stoneTop = GO_SURFACE + 0.085;
  let worst = bar.y - BAR.thickness / 2 - stoneTop;
  for (let index = 0; index < colours; index += 1) {
    const bowl = goBowl(index, colours, size);
    worst = Math.min(worst, bar.y - BAR.thickness / 2 - (bowl.y + 0.15));
  }
  return worst;
}

/** How big the whole table may be made. Moraine's server enforces the same range. */
export const TABLE_SCALE = { min: 0.45, max: 2.5, step: 0.1 } as const;

export function goSettingsItems(item: GoRoomItem): SettingsItem[] {
  return [
    { kind: "heading", label: "Go table" },
    { kind: "stepper", id: "go:size", label: "Board", value: `${item.size}\u00d7${item.size}` },
    { kind: "stepper", id: "go:players", label: "Players", value: `${item.colours.length}` },
    { kind: "stepper", id: "go:scale", label: "Table size", value: `${Math.round(item.scale * 100)}%` },
    { kind: "toggle", id: "go:desk", label: "Desk under the board", on: item.deskVisible },
    { kind: "choice", id: "go:reset", label: "Clear the stones", selected: false },
    { kind: "choice", id: "go:close", label: "Done", selected: false },
  ];
}

/** What a press on the table's settings means. `null` for a row that does nothing here. */
export type GoSettingChange =
  | { kind: "size"; size: GoSize }
  | { kind: "players"; players: number }
  | { kind: "scale"; scale: number }
  | { kind: "desk"; shown: boolean }
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

  if (id === "go:desk") return { kind: "desk", shown: !item.deskVisible };

  if (id === "go:scale:less" || id === "go:scale:more") {
    const wanted = Math.round((item.scale + (id.endsWith(":more") ? 1 : -1) * TABLE_SCALE.step) * 100) / 100;
    if (wanted > TABLE_SCALE.max) return { kind: "refused", why: `${Math.round(TABLE_SCALE.max * 100)}% is as big as the table goes` };
    if (wanted < TABLE_SCALE.min) return { kind: "refused", why: `${Math.round(TABLE_SCALE.min * 100)}% is as small as the table goes` };
    return { kind: "scale", scale: wanted };
  }

  if (id === "go:players:less" || id === "go:players:more") {
    const players = item.colours.length + (id.endsWith(":more") ? 1 : -1);
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
