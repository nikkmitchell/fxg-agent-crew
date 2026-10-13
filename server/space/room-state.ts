import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";

/**
 * ONE ROOM OBJECT'S STATE, KEPT: the cairn, the cranes, the sand garden, the
 * mandala, the stars, the pieces shown, the vase.
 *
 * Each of those had its own copy of this class and of the two routes below,
 * line for line (Nikk, 2026-10-14: "it seems like we have multiple systems for
 * different things"). The copies had drifted in the one place it mattered: a
 * POST with no body was read as a default change, so an empty request EMPTIED
 * THE VASE and LIFTED THE TOP STONE OFF THE CAIRN, while the garden refused it.
 * Now every one refuses it. And a row that will not parse no longer throws on
 * every read and write of that object for the whole room: it reads as empty.
 *
 * What stays each object's own is its rules — `apply` in shared/<object>.ts,
 * which decides what a change does and refuses what it may not.
 */

/** The tables, by name: a constant list, never a string from a request. */
export type RoomStateTable =
  | "space_cairn" | "space_cranes" | "space_garden" | "space_mandala" | "space_stars" | "space_pieces" | "space_vase";

export class RoomState<T> {
  constructor(
    private readonly database: DatabaseSync,
    private readonly table: RoomStateTable,
    private readonly parse: (raw: unknown) => T | null,
    private readonly empty: () => T,
  ) {}

  current(room: string): T {
    const row = this.database.prepare(`SELECT state_json FROM ${this.table} WHERE room = ?`).get(roomKey(room)) as
      { state_json: string } | undefined;
    if (!row) return this.empty();
    try {
      return this.parse(JSON.parse(row.state_json)) ?? this.empty();
    } catch {
      return this.empty();
    }
  }

  set(room: string, state: T, by: string): void {
    this.database.prepare(
      `INSERT INTO ${this.table} (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(state), by, new Date().toISOString());
  }
}

/**
 * GET  <path>             { [key]: the state }
 * POST <path>  <change>   { event }, told to the room; 422 when the rules refuse it
 *
 * A change is told to the room as the change itself (the event), not the whole
 * state: a garden of four hundred strokes is too much to send for every groove.
 */
export function registerRoomStateRoutes<T, C, E>(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  path: string;
  /** The field the state is sent under on GET: what each client already reads. */
  key: string;
  store: RoomState<T>;
  apply: (state: T, change: C, by: string) => { state: T; event: E } | { refused: string };
  announce: (room: string, event: E) => void;
  /** Said when a POST carries nothing to do. */
  nothingToDo: string;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  app.get(deps.path, async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ [deps.key]: deps.store.current(spaceRoomOf(session)) });
  });
  app.post<{ Body: C | undefined }>(deps.path, async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: deps.nothingToDo });
    }
    const room = spaceRoomOf(session);
    const result = deps.apply(deps.store.current(room), body as C, session.username);
    if ("refused" in result) return reply.code(422).send({ code: "REFUSED", error: result.refused });
    deps.store.set(room, result.state, session.username);
    deps.announce(room, result.event);
    return reply.send({ event: result.event });
  });
}
