import type { GoRoomItem } from "../../shared/room-items";
import { countGo, goLeaders } from "../../shared/go-score";
import { legalGoMoves } from "../../shared/go-rules";
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


/**
 * NO LEGAL MOVE: SAY SO. Baiwei, at a nearly full 5×5 with Black to play: "I
 * cannot make a move. Is it assigned to someone?" Every empty point was
 * suicide or a ko retake, so the stone would not go down anywhere and nothing
 * on the table said why. The answer is to pass, and the table now says that.
 */
export function noMoveLine(item: GoRoomItem): string | null {
  if (item.ended || item.liftedColour !== null) return null;
  if (legalGoMoves(item.stones, item.size, item.activeColour).length > 0) return null;
  return `No legal move for ${NAMES[item.activeColour].toUpperCase()}: press PASS at the glowing bowl`;
}
