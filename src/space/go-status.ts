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
  // SHORT, ALWAYS. SETTINGS and MOVE sit either side of this line with room
  // for "WHITE'S TURN" and no more: "WHITE'S TURN · BLACK PASSED" ran into
  // both. Who passed goes on the line below (passLine).
  if (item.ended) return "GAME OVER";
  return `${NAMES[item.activeColour].toUpperCase()}'S TURN`;
}

/**
 * One more pass ends it: said on the table, so whoever is next knows that a
 * pass now is the end of the game, not just a skipped turn.
 */
export function lastPassLine(item: GoRoomItem): string | null {
  if (item.ended || item.passes === 0) return null;
  const last = (item.activeColour - 1 + item.colours.length) % item.colours.length;
  const who = `${NAMES[last].toUpperCase()} passed`;
  if (item.passes === item.colours.length - 1) return `${who}: one more pass ends the game`;
  return `${who} (${item.passes} in a row; the game ends when all ${item.colours.length} pass)`;
}

/** Whether PASS is offered: during a game that has a stone in it, with nothing in the air. */
export function canPass(item: GoRoomItem): boolean {
  return !item.ended && item.liftedColour === null && (item.stones.length > 0 || item.captures.length > 0);
}

/**
 * What the PASS button says. When this pass would end the game, it says so:
 * Baiwei found the plain word "not very clear ... that you have to pass and the
 * game is done".
 */
export function passLabel(item: GoRoomItem): string {
  return item.passes === item.colours.length - 1 ? "PASS · ENDS GAME" : "PASS";
}

/** The colours ahead once the game is over (more than one on a tie); none before. */
export function winners(item: GoRoomItem): number[] {
  if (!item.ended) return [];
  return goLeaders(countGo(item.stones, item.size, item.colours.length).scores);
}

/**
 * The result, in rows rather than one long line (Baiwei: "should be arranged
 * more neatly"): who won, then each colour's count, highest first, then how to
 * start again.
 */
export function resultRows(item: GoRoomItem): { verdict: string; scores: { colour: number; text: string }[]; again: string } | null {
  if (!item.ended) return null;
  const { scores } = countGo(item.stones, item.size, item.colours.length);
  const leaders = goLeaders(scores);
  return {
    verdict: leaders.length === 1 ? `${NAMES[leaders[0]].toUpperCase()} WINS` : "A TIE",
    scores: [...scores].sort((a, b) => b.total - a.total || a.colour - b.colour)
      .map((score) => ({ colour: score.colour, text: `${NAMES[score.colour].toUpperCase()} ${score.total}` })),
    again: "Clear the stones in settings for a new game",
  };
}

/**
 * The count, in words: after the game, the result; during it, only when LAND
 * is switched on, and then marked provisional — Moraine's point, and right: a
 * live count reads as a verdict unless it says it is not one.
 */
export function scoreLine(item: GoRoomItem): string | null {
  // Once it is over, resultRows says it, in rows.
  if (item.ended || !item.territoryShown) return null;
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
