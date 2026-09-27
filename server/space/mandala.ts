import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { applyMandala, emptyMandala, parseMandala, type Mandala, type MandalaChange, type MandalaEvent } from "../../shared/mandala.js";

/**
 * Each room's sand mandala. See shared/mandala.ts.
 *
 * STORED until it is swept: it is built over days, by whoever passes.
 */
export class RoomMandalas {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): Mandala {
    const row = this.database.prepare("SELECT state_json FROM space_mandala WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    if (!row) return emptyMandala();
    return parseMandala(JSON.parse(row.state_json)) ?? emptyMandala();
  }
  set(room: string, mandala: Mandala, by: string): void {
    this.database.prepare(
      `INSERT INTO space_mandala (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(mandala), by, new Date().toISOString());
  }
}

/**
 * GET  /bff/space/mandala                              the plate as it is
 * POST /bff/space/mandala  { action: "pour", colour, points } | { action: "sweep" }
 *
 * Told to the room as the change itself, not the whole plate.
 */
export function registerMandalaRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  mandalas: RoomMandalas;
  announce: (room: string, event: MandalaEvent) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.get("/bff/space/mandala", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ mandala: deps.mandalas.current(spaceRoomOf(session)) });
  });

  app.post<{ Body: MandalaChange | undefined }>("/bff/space/mandala", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const body = request.body;
    if (!body || typeof body !== "object") return reply.code(400).send({ code: "BAD_REQUEST", error: "Say what to do with the sand: pour or sweep." });
    const result = applyMandala(deps.mandalas.current(room), body, session.username, () => randomUUID().slice(0, 8));
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.mandalas.set(room, result.mandala, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
