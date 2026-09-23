import type { GoRoomItem, RoomItem } from "../../shared/room-items";

/**
 * How the Go table sends its changes — out of the component so it can be
 * tested against the condition that broke it in a headset.
 *
 * Nikk: "all the go board settings don't do anything when I open the settings
 * and then click on things". The server log showed fifteen presses, four
 * accepted and eleven refused 409 "The table changed". The headset's socket was
 * reconnecting every half minute, and a table's new state reached the client
 * ONLY by that socket: one success moved the revision on, the headset never
 * heard, and every press after it carried the stale revision. A refusal
 * broadcasts nothing, so it stayed stale. Press, nothing; press, nothing.
 *
 * Three rules, each tested with a socket that never delivers:
 *
 *   1. THE ANSWER IS APPLIED AT ONCE, and remembered here too — so the very
 *      next press uses it even before React has re-rendered with it.
 *   2. "The table changed" CATCHES UP (fetches the tables) instead of leaving
 *      the next press to fail the same way.
 *   3. A settings change or a carry is RETRIED ONCE, worked out afresh from the
 *      caught-up table. A stone MOVE is not: refusing a move against a board
 *      that changed underneath it is exactly what the revision is for.
 */

export type TableApi = {
  configure: (id: string, change: Record<string, unknown>) => Promise<{ item: RoomItem }>;
  act: (id: string, action: Record<string, unknown>) => Promise<{ item: RoomItem }>;
  items: () => Promise<{ items: RoomItem[] }>;
};

export type TableWriter = {
  /** A game action. Never retried. Resolves true when the server accepted it. */
  act: (action: Record<string, unknown>) => Promise<boolean>;
  /**
   * A settings change or a carry. `again` works the request out afresh from the
   * table as it now is, for the one retry after "The table changed".
   */
  configure: (
    change: Record<string, unknown>,
    again?: (fresh: GoRoomItem) => Record<string, unknown> | null,
  ) => Promise<boolean>;
};

/** Whether an error is the server saying this table's revision moved on. */
export function isTableChanged(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "TABLE_CHANGED";
}

const message = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

export function goTableWriter(deps: {
  /** The table as the client currently holds it — possibly stale. */
  current: () => GoRoomItem;
  /** Apply a table the server just answered with. */
  apply: (item: RoomItem) => void;
  api: TableApi;
  notice: (text: string) => void;
  /**
   * The in-flight flag, SHARED with whoever else needs to know: the table's
   * hand-contact loop reads it every frame so a fingertip cannot start a second
   * action while one is on its way. Its own if not given.
   */
  pending?: { current: boolean };
}): TableWriter {
  const flag = deps.pending ?? { current: false };
  /** The freshest answer this writer has seen, in case React has not caught up yet. */
  let answered: GoRoomItem | null = null;

  const freshest = (): GoRoomItem => {
    const held = deps.current();
    return answered && answered.id === held.id && (answered.revision ?? 0) > (held.revision ?? 0) ? answered : held;
  };
  const take = (item: RoomItem) => {
    // Only THIS table's answer is remembered; a catch-up returns every table in
    // the room, and the last of them is not necessarily this one.
    if (item.id === deps.current().id) answered = item as GoRoomItem;
    deps.apply(item);
  };
  const catchUp = async (): Promise<GoRoomItem | null> => {
    try {
      const { items } = await deps.api.items();
      items.forEach(take);
      const id = deps.current().id;
      return (items.find((one) => one.id === id) as GoRoomItem | undefined) ?? null;
    } catch {
      return null;
    }
  };

  return {
    async act(action) {
      if (flag.current) return false;
      flag.current = true;
      const item = freshest();
      try {
        const { item: now } = await deps.api.act(item.id, { ...action, revision: item.revision });
        take(now);
        return true;
      } catch (error) {
        if (isTableChanged(error)) await catchUp();
        deps.notice(message(error, "Could not update the table."));
        return false;
      } finally {
        flag.current = false;
      }
    },

    async configure(change, again) {
      if (flag.current) return false;
      flag.current = true;
      const item = freshest();
      try {
        const { item: now } = await deps.api.configure(item.id, { ...change, revision: item.revision });
        take(now);
        return true;
      } catch (error) {
        if (isTableChanged(error)) {
          const fresh = await catchUp();
          const retry = fresh && again ? again(fresh) : null;
          if (fresh && retry) {
            try {
              const { item: now } = await deps.api.configure(item.id, { ...retry, revision: fresh.revision });
              take(now);
              deps.notice("");
              return true;
            } catch (second) {
              deps.notice(message(second, "Could not change the table."));
              return false;
            }
          }
        }
        deps.notice(message(error, "Could not change the table."));
        return false;
      } finally {
        flag.current = false;
      }
    },
  };
}
