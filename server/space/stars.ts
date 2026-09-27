import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { applyStars, emptySky, parseSky, type StarChange, type StarEvent, type StarSky } from "../../shared/stars.js";

/** Each room's star map, stored: its constellations build up. See shared/stars.ts. */
export class RoomSkies {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): StarSky {
    const row = this.database.prepare("SELECT state_json FROM space_stars WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    return row ? parseSky(JSON.parse(row.state_json)) ?? emptySky() : emptySky();
  }
  set(room: string, sky: StarSky, by: string): void {
    this.database.prepare(
      `INSERT INTO space_stars (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(sky), by, new Date().toISOString());
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
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  app.get("/bff/space/stars", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ sky: deps.skies.current(spaceRoomOf(session)) });
  });
  app.post<{ Body: StarChange | undefined }>("/bff/space/stars", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const result = applyStars(deps.skies.current(room), request.body ?? { a: null, b: null }, session.username);
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.skies.set(room, result.sky, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
