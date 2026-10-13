import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { applyVase, emptyVase, parseVase, type VaseChange, type VaseEvent, type Vase } from "../../shared/ikebana.js";
import { RoomState, registerRoomStateRoutes } from "./room-state.js";

/** Each room's ikebana vase, stored until emptied. See shared/ikebana.ts. */
export class RoomVases extends RoomState<Vase> {
  constructor(database: DatabaseSync) {
    super(database, "space_vase", parseVase, emptyVase);
  }
}

/**
 * GET  /bff/space/vase           the vase as it is
 * POST /bff/space/vase { action: place|empty } arrange or empty it
 */
export function registerVaseRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  vases: RoomVases;
  announce: (room: string, event: VaseEvent) => void;
}): void {
  registerRoomStateRoutes<Vase, VaseChange, VaseEvent>(app, {
    config: deps.config,
    sessions: deps.sessions,
    path: "/bff/space/vase",
    key: "vase",
    store: deps.vases,
    apply: (state, change, by) => {
      const result = applyVase(state, change, by);
      return "refused" in result ? result : { state: result.vase, event: result.event };
    },
    announce: deps.announce,
    nothingToDo: "Say what to do with the vase: place a stem, or empty it.",
  });
}
