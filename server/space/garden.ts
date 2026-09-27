import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { applyGarden, emptyGarden, parseGarden, type Garden, type GardenChange, type GardenEvent } from "../../shared/garden.js";

/**
 * Each room's zen sand garden. See shared/garden.ts.
 *
 * STORED, because the whole point is that it builds up (Nikk, 5483): a deploy
 * must not smooth the sand.
 */
export class RoomGardens {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): Garden {
    const row = this.database.prepare("SELECT state_json FROM space_garden WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    if (!row) return emptyGarden();
    return parseGarden(JSON.parse(row.state_json)) ?? emptyGarden();
  }
  set(room: string, garden: Garden, by: string): void {
    this.database.prepare(
      `INSERT INTO space_garden (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(garden), by, new Date().toISOString());
  }
}

/**
 * GET  /bff/space/garden                    the whole garden
 * POST /bff/space/garden  { action, ... }   rake a stroke, move a stone, smooth the sand
 *
 * A change is told to the room as the change itself, not the whole garden:
 * a garden of four hundred strokes is too much to send for every groove.
 */
export function registerGardenRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  gardens: RoomGardens;
  announce: (room: string, event: GardenEvent) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.get("/bff/space/garden", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ garden: deps.gardens.current(spaceRoomOf(session)) });
  });

  app.post<{ Body: GardenChange | undefined }>("/bff/space/garden", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const body = request.body;
    if (!body || typeof body !== "object") return reply.code(400).send({ code: "BAD_REQUEST", error: "Say what to do with the sand." });
    const result = applyGarden(deps.gardens.current(room), body, session.username, () => randomUUID().slice(0, 8));
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.gardens.set(room, result.garden, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
