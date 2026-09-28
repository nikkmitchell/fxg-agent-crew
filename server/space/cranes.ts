import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { applyCranes, noCranes, parseCranes, type CraneChange, type CraneEvent, type Cranes } from "../../shared/cranes.js";

/** Each room's paper cranes, stored: a thousand, over days. See shared/cranes.ts. */
export class RoomCranes {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): Cranes {
    const row = this.database.prepare("SELECT state_json FROM space_cranes WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    return row ? parseCranes(JSON.parse(row.state_json)) ?? noCranes() : noCranes();
  }
  set(room: string, cranes: Cranes, by: string): void {
    this.database.prepare(
      `INSERT INTO space_cranes (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(cranes), by, new Date().toISOString());
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
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  app.get("/bff/space/cranes", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ cranes: deps.cranes.current(spaceRoomOf(session)) });
  });
  app.post<{ Body: CraneChange | undefined }>("/bff/space/cranes", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const result = applyCranes(deps.cranes.current(room), request.body ?? { action: "fold" as const, paper: 0 }, session.username);
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.cranes.set(room, result.cranes, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
