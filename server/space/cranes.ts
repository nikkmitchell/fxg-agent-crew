import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { applyCranes, noCranes, parseCranes, type CraneChange, type CraneEvent, type Cranes } from "../../shared/cranes.js";
import { RoomState, registerRoomStateRoutes } from "./room-state.js";

/** Each room's paper cranes, stored: a thousand, over days. See shared/cranes.ts. */
export class RoomCranes extends RoomState<Cranes> {
  constructor(database: DatabaseSync) {
    super(database, "space_cranes", parseCranes, noCranes);
  }
}

/**
 * GET  /bff/space/cranes           the cranes as they hang
 * POST /bff/space/cranes { action: fold, paper } or { action: release } (only at a thousand)
 */
export function registerCraneRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  cranes: RoomCranes;
  announce: (room: string, event: CraneEvent) => void;
}): void {
  registerRoomStateRoutes<Cranes, CraneChange, CraneEvent>(app, {
    config: deps.config,
    sessions: deps.sessions,
    path: "/bff/space/cranes",
    key: "cranes",
    store: deps.cranes,
    apply: (state, change, by) => {
      const result = applyCranes(state, change, by);
      return "refused" in result ? result : { state: result.cranes, event: result.event };
    },
    announce: deps.announce,
    nothingToDo: "Say what to do with the cranes: fold one, or release them.",
  });
}
