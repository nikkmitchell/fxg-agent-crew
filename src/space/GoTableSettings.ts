import { GO_PLAYERS, GO_SIZES, stepGoSize, stepGoSurface, type GoRoomItem, type GoSize, type GoSurface } from "../../shared/room-items";

/**
 * What a press on the Go table's settings means, what it costs, and what it
 * sends — decided here, with no renderer, and tested.
 *
 * WHY THE SETTINGS ARE THE TABLE'S OWN. Nikk: "make the settings for board grid
 * size and number of players to be a settings button on the go board... as
 * well as reset it and so on". They used to be a row per size per table in a
 * menu on the far side of the room.
 *
 * WHERE THEY ARE DRAWN is `go-controls.ts`: flat on the table, as text. They
 * were a floating gear and grab bar first, and Nikk, in a headset: "I really
 * don't like the grab for the Go thing being floating above in the air". What
 * that version learned is kept there: above all, that a control the right size
 * in metres can still be unhittable, which this table showed four times.
 *
 * BUILT ON MORAINE'S TABLE. We redesigned it at the same time without knowing;
 * theirs shipped first and is better, so what is left of mine is the settings,
 * `players` and `reset` on the server, and the carrying.
 */

/** How big the whole table may be made. Moraine's server enforces the same range. */
export const TABLE_SCALE = { min: 0.45, max: 2.5, step: 0.1 } as const;

/** What a press on the table's settings means. `null` for a row that does nothing here. */
export type GoSettingChange =
  | { kind: "size"; size: GoSize }
  | { kind: "players"; players: number }
  | { kind: "scale"; scale: number }
  | { kind: "desk"; shown: boolean }
  | { kind: "surface"; surface: GoSurface }
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

  // Board types go round: past the last is the first. Only the look changes,
  // so it never costs anything and is never refused.
  if (id === "go:surface:less" || id === "go:surface:more") {
    return { kind: "surface", surface: stepGoSurface(item.surface, id.endsWith(":more") ? 1 : -1) };
  }

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

/** What to send the server for a settings press, worked out from a given state of the table. */
export type GoSettingRequest =
  | { size: GoSize }
  | { players: number }
  | { scale: number }
  | { deskVisible: boolean }
  | { surface: GoSurface }
  | { reset: true };

/**
 * The request a press means, FROM THIS STATE OF THE TABLE — or null when it
 * means nothing to send (closing the panel, or a press against a limit).
 *
 * A function of the table rather than a value computed once, because the
 * retry after "The table changed" has to mean the same thing against the table
 * as it now is: "one more player" is one more than there are NOW, not one more
 * than there were when the press was made. Resending the old value would undo
 * whatever somebody else just changed.
 */
export function goSettingRequest(item: GoRoomItem, id: string): GoSettingRequest | null {
  const change = goSettingFor(item, id);
  if (!change) return null;
  switch (change.kind) {
    case "size":
      return { size: change.size };
    case "players":
      return { players: change.players };
    case "scale":
      return { scale: change.scale };
    case "desk":
      return { deskVisible: change.shown };
    case "surface":
      return { surface: change.surface };
    case "reset":
      return { reset: true };
    default:
      return null;
  }
}
