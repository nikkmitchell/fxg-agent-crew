import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { applyGarden, emptyGarden, parseGarden, type GardenChange, type GardenEvent, type Garden } from "../../shared/garden.js";
import { RoomState, registerRoomStateRoutes } from "./room-state.js";

/**
 * Each room's zen sand garden. See shared/garden.ts.
 *
 * STORED, because the whole point is that it builds up (Nikk, 5483): a deploy
 * must not smooth the sand.
 */
export class RoomGardens extends RoomState<Garden> {
  constructor(database: DatabaseSync) {
    super(database, "space_garden", parseGarden, emptyGarden);
  }
}

/**
 * GET  /bff/space/garden                    the whole garden
 * POST /bff/space/garden  { action, ... }   rake a stroke, move a stone, smooth the sand
 */
export function registerGardenRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  gardens: RoomGardens;
  announce: (room: string, event: GardenEvent) => void;
}): void {
  registerRoomStateRoutes<Garden, GardenChange, GardenEvent>(app, {
    config: deps.config,
    sessions: deps.sessions,
    path: "/bff/space/garden",
    key: "garden",
    store: deps.gardens,
    apply: (state, change, by) => {
      const result = applyGarden(state, change, by, () => randomUUID().slice(0, 8));
      return "refused" in result ? result : { state: result.garden, event: result.event };
    },
    announce: deps.announce,
    nothingToDo: "Say what to do with the sand.",
  });
}
