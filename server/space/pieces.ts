import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { applyPieces, allShown, parsePieces, type PiecesChange, type PiecesEvent, type RoomPieces } from "../../shared/room-pieces.js";

/** Which pieces each room has hidden, stored. See shared/room-pieces.ts. */
export class RoomPiecesStore {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): RoomPieces {
    const row = this.database.prepare("SELECT state_json FROM space_pieces WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    return row ? parsePieces(JSON.parse(row.state_json)) ?? allShown() : allShown();
  }
  set(room: string, pieces: RoomPieces, by: string): void {
    this.database.prepare(
      `INSERT INTO space_pieces (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(pieces), by, new Date().toISOString());
  }
}

/**
 * GET  /bff/space/pieces           which pieces are hidden
 * POST /bff/space/pieces { name, shown } or { all } turn one piece, or all, on or off, for everyone
 */
export function registerPiecesRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  pieces: RoomPiecesStore;
  announce: (room: string, event: PiecesEvent) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  app.get("/bff/space/pieces", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ pieces: deps.pieces.current(spaceRoomOf(session)) });
  });
  app.post<{ Body: PiecesChange | undefined }>("/bff/space/pieces", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const result = applyPieces(deps.pieces.current(room), request.body ?? { all: true }, session.username);
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.pieces.set(room, result.pieces, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
