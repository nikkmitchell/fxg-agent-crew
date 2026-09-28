import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { applyCairn, emptyCairn, parseCairn, type CairnChange, type CairnEvent, type Cairn } from "../../shared/cairn.js";

/** Each room's cairn, stored: it grows. See shared/cairn.ts. */
export class RoomCairns {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): Cairn {
    const row = this.database.prepare("SELECT state_json FROM space_cairn WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    return row ? parseCairn(JSON.parse(row.state_json)) ?? emptyCairn() : emptyCairn();
  }
  set(room: string, cairn: Cairn, by: string): void {
    this.database.prepare(
      `INSERT INTO space_cairn (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(cairn), by, new Date().toISOString());
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
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  app.get("/bff/space/cairn", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ cairn: deps.cairns.current(spaceRoomOf(session)) });
  });
  app.post<{ Body: CairnChange | undefined }>("/bff/space/cairn", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const result = applyCairn(deps.cairns.current(room), request.body ?? { action: "lift" as const }, session.username);
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.cairns.set(room, result.cairn, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
