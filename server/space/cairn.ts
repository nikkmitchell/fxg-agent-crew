import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { applyCairn, emptyCairn, parseCairn, type CairnChange, type CairnEvent, type Cairn } from "../../shared/cairn.js";
import { RoomState, registerRoomStateRoutes } from "./room-state.js";

/** Each room's cairn, stored: it grows. See shared/cairn.ts. */
export class RoomCairns extends RoomState<Cairn> {
  constructor(database: DatabaseSync) {
    super(database, "space_cairn", parseCairn, emptyCairn);
  }
}

/**
 * GET  /bff/space/cairn           the cairn as it stands
 * POST /bff/space/cairn { action: add|lift } add a stone, or lift the top one
 */
export function registerCairnRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  cairns: RoomCairns;
  announce: (room: string, event: CairnEvent) => void;
}): void {
  registerRoomStateRoutes<Cairn, CairnChange, CairnEvent>(app, {
    config: deps.config,
    sessions: deps.sessions,
    path: "/bff/space/cairn",
    key: "cairn",
    store: deps.cairns,
    apply: (state, change, by) => {
      const result = applyCairn(state, change, by);
      return "refused" in result ? result : { state: result.cairn, event: result.event };
    },
    announce: deps.announce,
    nothingToDo: "Say what to do with the cairn: add a stone, or lift one.",
  });
}
