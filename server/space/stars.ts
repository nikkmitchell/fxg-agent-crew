import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { applyStars, emptySky, parseSky, type StarChange, type StarEvent, type StarSky } from "../../shared/stars.js";
import { RoomState, registerRoomStateRoutes } from "./room-state.js";

/** Each room's star map, stored: its constellations build up. See shared/stars.ts. */
export class RoomSkies extends RoomState<StarSky> {
  constructor(database: DatabaseSync) {
    super(database, "space_stars", parseSky, emptySky);
  }
}

/**
 * GET  /bff/space/stars           the room's constellations
 * POST /bff/space/stars { a, b }  join two stars, or unjoin them
 */
export function registerStarRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  skies: RoomSkies;
  announce: (room: string, event: StarEvent) => void;
}): void {
  registerRoomStateRoutes<StarSky, StarChange, StarEvent>(app, {
    config: deps.config,
    sessions: deps.sessions,
    path: "/bff/space/stars",
    key: "sky",
    store: deps.skies,
    apply: (state, change, by) => {
      const result = applyStars(state, change, by);
      return "refused" in result ? result : { state: result.sky, event: result.event };
    },
    announce: deps.announce,
    nothingToDo: "Say which two stars to join, or unjoin.",
  });
}
