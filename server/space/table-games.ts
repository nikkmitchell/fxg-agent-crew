import { sameActor } from "../../shared/board-rules.js";
import {
  applyGameMove,
  initialGame,
  type GameRoomItem,
  type GameMove,
} from "../../shared/table-games.js";
export type GameAction = {
  action?: unknown;
  revision?: unknown;
  side?: unknown;
  from?: unknown;
  to?: unknown;
  column?: unknown;
  promotion?: unknown;
};
const same = (a: string | null, b: string) => a !== null && sameActor(a, b);
/** All changes are synchronous against the current persisted revision, shared by HTTP and socket. */
export function actOnTableGame(
  item: GameRoomItem,
  by: string,
  body: GameAction,
): { error: string; status: number } | GameRoomItem {
  if (body.revision !== item.revision)
    return {
      error: "The game changed. Read the latest position and try again.",
      status: 409,
    };
  const side = body.side;
  if (body.action === "join") {
    if (side !== 1 && side !== 2)
      return { error: "Choose side 1 or 2.", status: 400 };
    if (item.seats[side - 1] && !same(item.seats[side - 1], by))
      return { error: "That side is already taken.", status: 409 };
    item.seats[side - 1] = by;
  } else if (body.action === "leave") {
    if (side !== 1 && side !== 2)
      return { error: "Choose the side to leave.", status: 400 };
    if (!same(item.seats[side - 1], by))
      return { error: "You can only leave your own seat.", status: 403 };
    item.seats[side - 1] = null;
    item.resetBy = [];
  } else if (body.action === "reset") {
    if (!item.seats.some((n) => same(n, by)))
      return {
        error: "Take a seat before requesting a new game.",
        status: 403,
      };
    if (!item.resetBy.some((n) => same(n, by))) item.resetBy.push(by);
    if (
      item.seats
        .filter((n): n is string => n !== null)
        .every((n) => item.resetBy.some((w) => same(w, n)))
    ) {
      item.state = initialGame(item.game);
      item.resetBy = [];
    }
  } else if (body.action === "cancel-reset") {
    item.resetBy = item.resetBy.filter((n) => !same(n, by));
  } else if (body.action === "resign") {
    if (!same(item.seats[item.state.turn - 1], by))
      return {
        error: "Only the player whose turn it is can resign.",
        status: 403,
      };
    if (item.state.winner !== null)
      return { error: "This game has already ended.", status: 409 };
    item.state.winner = item.state.turn === 1 ? 2 : 1;
    item.resetBy = [];
  } else if (body.action === "move") {
    if (!same(item.seats[item.state.turn - 1], by))
      return {
        error: "Take the side whose turn it is, or wait for your turn.",
        status: 403,
      };
    const move: GameMove = {};
    for (const key of ["from", "to", "column"] as const) {
      if (body[key] !== undefined) {
        if (!Number.isInteger(body[key]))
          return {
            error: "Squares and columns must be whole numbers.",
            status: 400,
          };
        move[key] = body[key] as number;
      }
    }
    if (body.promotion !== undefined) {
      if (
        typeof body.promotion !== "string" ||
        !["q", "r", "b", "n"].includes(body.promotion)
      )
        return {
          error: "Promote to queen, rook, bishop or knight.",
          status: 400,
        };
      move.promotion = body.promotion;
    }
    const next = applyGameMove(item.game, item.state, move);
    if ("error" in next) return { error: next.error, status: 400 };
    item.state = next;
    item.resetBy = [];
  } else
    return {
      error: "Choose join, leave, move, resign, reset or cancel-reset.",
      status: 400,
    };
  item.revision++;
  return item;
}
