import type { GoRoomItem } from "../../shared/room-items";
import { countGo, goLeaders } from "../../shared/go-score";
import { GO_NAMES as NAMES } from "../../shared/go-text";

/**
 * The line in front of the board: whose turn, who just passed, or that it is
 * over. "WHITE'S TURN · BLACK PASSED" tells the next player that one more pass
 * ends a two-player game.
 */
export function turnLine(item: GoRoomItem): string {
  if (item.ended) return "GAME OVER";
  const turn = `${NAMES[item.activeColour].toUpperCase()}'S TURN`;
  if (item.passes === 0) return turn;
  if (item.passes === 1) {
    const last = (item.activeColour - 1 + item.colours.length) % item.colours.length;
    return `${turn} · ${NAMES[last].toUpperCase()} PASSED`;
  }
  return `${turn} · ${item.passes} PASSED`;
}

/**
 * The count, in words: after the game, the result; during it, only when LAND
 * is switched on, and then marked provisional — Moraine's point, and right: a
 * live count reads as a verdict unless it says it is not one.
 */
export function scoreLine(item: GoRoomItem): string | null {
  if (!item.ended && !item.territoryShown) return null;
  const { scores } = countGo(item.stones, item.size, item.colours.length);
  const each = scores.map((score) => `${NAMES[score.colour].toUpperCase()} ${score.total}`).join(" · ");
  if (!item.ended) return `LAND SO FAR (provisional): ${each}`;
  const leaders = goLeaders(scores);
  const verdict = leaders.length === 1 ? `${NAMES[leaders[0]].toUpperCase()} WINS` : "A TIE";
  return `${verdict} · ${each} · clear the stones for a new game`;
}

