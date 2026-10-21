import { space } from "../../space-client";
import type { GameTablePort } from "../../engine/types";
import type { ServerMessage } from "../../../shared/space-wire";
import type { GameRoomItem, TableGame } from "../../../shared/table-games";

/** Match data rides the persisted room item, never the last-write-wins module relay. */
export function createGameHost(
  subscribe: (fn: (message: ServerMessage) => void) => () => void,
) {
  return (id: string): GameTablePort => {
    const listeners = new Set<(table: GameRoomItem) => void>();
    let watchedGame: TableGame | null = null;
    const refresh = () =>
      watchedGame
        ? space.openThingGame(id, watchedGame).then(({ table }) => {
            for (const fn of listeners) fn(table);
          })
        : Promise.resolve();
    return {
      watch(game, fn, failed) {
        let active = true,
          revision = -1;
        watchedGame = game;
        const deliver = (table: GameRoomItem) => {
          if (active && table.game === game && table.revision > revision) {
            revision = table.revision;
            fn(table);
          }
        };
        listeners.add(deliver);
        const off = subscribe((message) => {
          if (message.type !== "roomItems" && message.type !== "welcome")
            return;
          const [root, ...parts] = id.split("/");
          const item = message.items.find((item) => item.id === root);
          if (item?.kind === "module") {
            const table = item.tableGames?.[parts.join("/")];
            if (table) deliver(table);
          }
        });
        refresh().catch((error) => {
          if (active)
            failed?.(error instanceof Error ? error : new Error(String(error)));
        });
        return () => {
          active = false;
          listeners.delete(deliver);
          off();
        };
      },
      async action(change) {
        try {
          const { table } = await space.actOnThingGame(id, change);
          for (const fn of listeners) fn(table);
          return table;
        } catch (error) {
          await refresh().catch(() => {});
          throw error;
        }
      },
    };
  };
}
