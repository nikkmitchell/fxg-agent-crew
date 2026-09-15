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

/**
 * How long a changed card takes to fade back to normal.
 *
 * AN HOUR, not a minute. Nikk: "I like that feature but it's much too slow" —
 * meaning the fade was too FAST to be useful: "let's make the new card glow
 * from the initial color to fading out to the oldest color to go over an hour,
 * that way it's very easy for users to see what is there and what has been
 * sitting there." A minute only tells somebody standing at the board at that
 * moment; an hour tells anybody walking in what has moved this morning.
 */
export const FRESH_FADE_MS = 60 * 60_000;
/** Never keep a change hidden longer than this, whether or not its agent ever arrives. */
export const REVEAL_CAP_MS = 20_000;
/**
 * The most done cards a column shows before the rest fold away.
 *
 * Nikk: "let's have done max out at 10 items", then "a max of five", which was
 * misheard: "I didn't mean to have just five, I meant to add five more... let's
 * make 15". It replaced "finished more than three days ago", which still let a
 * busy day's work pile the column up.
 */
export const DONE_LIMIT = 15;

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

/**
 * How long after a change the board keeps asking the server for more.
 *
 * SHORTER THAN THE GLOW, deliberately. The glow now fades over an hour so
 * anybody walking up can see what moved this morning — but a card fading over
 * an hour does not need a request every two seconds for that hour. What needs
 * a fast poll is the minute around a change: a reveal waiting for its agent to
 * reach the board, and the card landing.
 */
export const LIVELY_MS = 45_000;

/**
 * Whether the board should keep asking the server: a change is waiting for its
 * agent to arrive, or one landed moments ago.
 */
export function boardIsLively(tasks: Array<{ fresh?: TaskFreshness }>, nowMs: number): boolean {
  return tasks.some((task) => {
    if (!task.fresh) return false;
    if (task.fresh.revealAt === null) return true;
    return nowMs - Date.parse(task.fresh.revealAt) < LIVELY_MS;
  });
}

/** Whether anything is still glowing, so the colour needs redrawing. */
export function boardIsGlowing(tasks: Array<{ fresh?: TaskFreshness }>, nowMs: number): boolean {
  return tasks.some((task) => glowAt(nowMs, task.fresh) > 0);
}
