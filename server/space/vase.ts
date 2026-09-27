import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { applyVase, emptyVase, parseVase, type VaseChange, type VaseEvent, type Vase } from "../../shared/ikebana.js";

/** Each room's ikebana vase, stored until emptied. See shared/ikebana.ts. */
export class RoomVases {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): Vase {
    const row = this.database.prepare("SELECT state_json FROM space_vase WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    return row ? parseVase(JSON.parse(row.state_json)) ?? emptyVase() : emptyVase();
  }
  set(room: string, vase: Vase, by: string): void {
    this.database.prepare(
      `INSERT INTO space_vase (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(vase), by, new Date().toISOString());
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
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  app.get("/bff/space/vase", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ vase: deps.vases.current(spaceRoomOf(session)) });
  });
  app.post<{ Body: VaseChange | undefined }>("/bff/space/vase", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const result = applyVase(deps.vases.current(room), request.body ?? { action: "empty" as const }, session.username);
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.vases.set(room, result.vase, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
