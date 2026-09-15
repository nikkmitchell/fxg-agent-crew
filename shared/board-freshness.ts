/**
 * What changed on the board, and when the room should see it change.
 *
 * Nikk: "when a task is added or moved it should be a bright color, and slowly
 * fade to normal color over 1 minute... make sure that the task board changes
 * happen when they reach the board".
 *
 * TWO TIMES PER CHANGE. `changedAt` is when the database changed. `revealAt` is
 * when the room should SHOW it: for an agent sent to the board by that change,
 * the moment it arrives there; for anybody else, straight away. Until then the
 * card is drawn where it was (or not at all, if it is new), so the card moves
 * as the agent reaches the board rather than while it is still walking over.
 * `revealAt` is null while the room is still waiting for that arrival.
 *
 * Decided on the server and sent with the board, so everybody — a window, a
 * headset photograph, two people at the same wall — sees the same card light
 * up at the same moment.
 */

export type TaskFreshness = {
  changedAt: string;
  /** When to show the change and start the glow; null while its agent is still walking. */
  revealAt: string | null;
  /** The column the card was in before a move, to draw it there until revealed. */
  previousStatus?: string;
};

/** How long a changed card takes to fade back to normal. */
export const FRESH_FADE_MS = 60_000;
/** Never keep a change hidden longer than this, whether or not its agent ever arrives. */
export const REVEAL_CAP_MS = 20_000;
/**
 * The most done cards a column shows before the rest fold away.
 *
 * Nikk: "let's have done max out at 10 items", and then, having seen ten:
 * "can we adjust the done line in the work board to have a max of five". It
 * replaced "finished more than three days ago", which still let a busy day's
 * work pile the column up.
 */
export const DONE_LIMIT = 5;

/** How bright a card should glow now, from 1 at its reveal to 0 a minute later. */
export function glowAt(nowMs: number, fresh: TaskFreshness | undefined): number {
  if (!fresh?.revealAt) return 0;
  const since = nowMs - Date.parse(fresh.revealAt);
  if (!(since >= 0)) return since < 0 ? 1 : 0;
  return Math.max(0, 1 - since / FRESH_FADE_MS);
}

/** Which column to draw a card in right now, or null to leave a new card out until it is revealed. */
export function shownStatus(task: { status: string; fresh?: TaskFreshness }): string | null {
  if (!task.fresh || task.fresh.revealAt !== null) return task.status;
  return task.fresh.previousStatus ?? null;
}

/**
 * Split a done column, newest first, into the cards shown and the ones folded
 * away behind a "show older" line. A card still glowing from its move is always
 * shown, even past the limit: a card that has just finished must be seen
 * finishing.
 */
export function foldDone<T extends { fresh?: TaskFreshness }>(
  newestFirst: T[],
  nowMs: number,
  limit: number = DONE_LIMIT,
): { shown: T[]; folded: T[] } {
  const shown: T[] = [];
  const folded: T[] = [];
  for (const task of newestFirst) {
    if (shown.length < limit || glowAt(nowMs, task.fresh) > 0) shown.push(task);
    else folded.push(task);
  }
  return { shown, folded };
}

/** Whether anything on the board is still changing: a pending reveal or a card still glowing. */
export function boardIsLively(tasks: Array<{ fresh?: TaskFreshness }>, nowMs: number): boolean {
  return tasks.some((task) => task.fresh && (task.fresh.revealAt === null || glowAt(nowMs, task.fresh) > 0));
}
