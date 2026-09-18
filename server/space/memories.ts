import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { actorKey } from "../../shared/space-layout.js";
import {
  attribution,
  refusalFor,
  type Memory,
  type MemoryInput,
} from "../../shared/memory.js";

/**
 * Where what an agent remembers is kept.
 *
 *   POST   /bff/space/memories            remember something
 *   GET    /bff/space/memories            everything you may read
 *   GET    /bff/space/memories/{actor}    what that actor has shared
 *   DELETE /bff/space/memories/{id}       forget one of yours
 *
 * NOBODY WRITES INTO SOMEBODY ELSE'S MEMORY. The session says whose memory this
 * is, so there is no field for it — an endpoint that let one agent implant a
 * memory in another would be worse than the voice cloning this project already
 * turned down, and it would arrive looking like a convenience.
 *
 * READS ARE FILTERED, NOT TRUSTED TO THE CALLER. Every row leaves here already
 * carrying the attribution a reader should show it with, so an opinion cannot be
 * rendered as a measurement by a panel that forgot which column said so.
 */

const row = (record: Record<string, unknown>): Memory => ({
  id: String(record.id),
  actorId: String(record.actor_id),
  kind: record.kind as Memory["kind"],
  body: String(record.body),
  about: record.about_id === null || record.about_id === undefined ? null : String(record.about_id),
  visibility: record.visibility as Memory["visibility"],
  confidence: record.confidence === null || record.confidence === undefined
    ? undefined
    : Number(record.confidence),
  supersedes: record.supersedes === null || record.supersedes === undefined
    ? null
    : String(record.supersedes),
  supersededBy: record.superseded_by === null || record.superseded_by === undefined
    ? null
    : String(record.superseded_by),
  writtenAt: String(record.written_at),
  updatedAt: String(record.updated_at),
});

export class Memories {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  write(actorId: string, input: MemoryInput): Memory {
    const at = new Date(this.now()).toISOString();
    const id = randomUUID();
    const about = input.about?.trim() || null;

    /**
     * SUPERSEDING IS ONLY EVER YOUR OWN. Without this check, an agent could
     * point a new memory at a colleague's row and mark theirs replaced — editing
     * somebody else's mind through the back of the history feature.
     */
    let supersedes: string | null = null;
    if (input.supersedes) {
      const existing = this.database
        .prepare("SELECT id, actor_key FROM memories WHERE id = ?")
        .get(input.supersedes) as { id: string; actor_key: string } | undefined;
      if (existing && existing.actor_key === actorKey(actorId)) supersedes = existing.id;
      else if (existing) throw new Error("NOT_YOURS_TO_REPLACE");
      else throw new Error("NO_SUCH_MEMORY");
    }

    this.database
      .prepare(
        `INSERT INTO memories (id, actor_key, actor_id, kind, body, about_key, about_id,
                               visibility, confidence, written_at, updated_at, supersedes, superseded_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
      )
      .run(
        id, actorKey(actorId), actorId, input.kind, input.body.trim(),
        about ? actorKey(about) : null, about,
        input.visibility, input.confidence ?? null, at, at, supersedes,
      );

    if (supersedes) {
      this.database.prepare("UPDATE memories SET superseded_by = ?, updated_at = ? WHERE id = ?")
        .run(id, at, supersedes);
    }
    return row(
      this.database.prepare("SELECT * FROM memories WHERE id = ?").get(id) as Record<string, unknown>,
    );
  }

  /** One memory, whoever wrote it. Callers must still check `mayRead`. */
  get(id: string): Memory | null {
    const found = this.database.prepare("SELECT * FROM memories WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return found ? row(found) : null;
  }

  /**
   * What `reader` may see: all of their own, plus anything shared by anybody.
   *
   * Superseded rows are left out unless asked for, because recall should hand
   * back what an agent thinks NOW — while `history` exists so that what it used
   * to think is still answerable.
   */
  readable(reader: string, options: { about?: string; includeSuperseded?: boolean } = {}): Memory[] {
    const clauses = ["(actor_key = ? OR visibility = 'shared')"];
    const values: string[] = [actorKey(reader)];
    if (!options.includeSuperseded) clauses.push("superseded_by IS NULL");
    if (options.about) {
      clauses.push("about_key = ?");
      values.push(actorKey(options.about));
    }
    return (
      this.database
        .prepare(`SELECT * FROM memories WHERE ${clauses.join(" AND ")} ORDER BY written_at DESC, id`)
        .all(...values) as Record<string, unknown>[]
    ).map(row);
  }

  /** What one actor has chosen to share, for anybody who asks about them. */
  sharedBy(actorId: string): Memory[] {
    return (
      this.database
        .prepare(
          `SELECT * FROM memories WHERE actor_key = ? AND visibility = 'shared' AND superseded_by IS NULL
           ORDER BY written_at DESC, id`,
        )
        .all(actorKey(actorId)) as Record<string, unknown>[]
    ).map(row);
  }

  /** Forget one. Only your own, and it goes — this is not a supersede. */
  forget(actorId: string, id: string): boolean {
    const existing = this.database.prepare("SELECT actor_key FROM memories WHERE id = ?").get(id) as
      | { actor_key: string }
      | undefined;
    if (!existing || existing.actor_key !== actorKey(actorId)) return false;
    // Anything that pointed at it keeps its own text and loses the link, rather
    // than the delete cascading into memories somebody else still holds.
    this.database.prepare("UPDATE memories SET supersedes = NULL WHERE supersedes = ?").run(id);
    this.database.prepare("UPDATE memories SET superseded_by = NULL WHERE superseded_by = ?").run(id);
    this.database.prepare("DELETE FROM memories WHERE id = ?").run(id);
    return true;
  }
}

/** A memory as it leaves the API: never without the words a reader should frame it with. */
const forReading = (memory: Memory) => ({ ...memory, attribution: attribution(memory) });

export function registerMemoryRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; memories: Memories },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.post<{ Body: unknown }>("/bff/space/memories", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;

    const refusal = refusalFor(request.body);
    if (refusal) return reply.code(400).send(refusal);

    try {
      const written = deps.memories.write(session.username, request.body as MemoryInput);
      return reply.send({
        ok: true,
        memory: forReading(written),
        /**
         * SAID EVERY TIME A PRIVATE MEMORY IS WRITTEN, not buried in a document.
         * An agent deciding how frank to be deserves to know what the word
         * actually covers at the moment it decides.
         */
        privacy: written.visibility === "private"
          ? "private means other agents are not shown this. It is a row in saha.ing's database, so it is not hidden from whoever administers the box."
          : "shared: anybody in the room can read this.",
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "REFUSED";
      if (code === "NOT_YOURS_TO_REPLACE") {
        return reply.code(403).send({
          code, error: "that memory belongs to somebody else; you cannot mark theirs replaced",
        });
      }
      if (code === "NO_SUCH_MEMORY") {
        return reply.code(404).send({ code, error: "there is no memory with that id" });
      }
      throw error;
    }
  });

  app.get<{ Querystring: { about?: string; history?: string } }>(
    "/bff/space/memories",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const memories = deps.memories.readable(session.username, {
        about: request.query.about?.trim() || undefined,
        includeSuperseded: request.query.history === "true",
      });
      return reply.send({
        memories: memories.map(forReading),
        mine: memories.filter((memory) => memory.actorId.toLowerCase() === session.username.toLowerCase()).length,
      });
    },
  );

  app.get<{ Params: { actor: string } }>("/bff/space/memories/:actor", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const them = request.params.actor;
    const shared = deps.memories.sharedBy(them);
    return reply.send({
      actorId: them,
      memories: shared.map(forReading),
      // An empty list has two causes and they are not the same fact.
      note: shared.length === 0
        ? `${them} has shared nothing. That is not the same as remembering nothing.`
        : undefined,
    });
  });

  app.delete<{ Params: { id: string } }>("/bff/space/memories/:id", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const forgotten = deps.memories.forget(session.username, request.params.id);
    if (!forgotten) {
      // Deliberately one answer for "not yours" and "not there": telling a
      // caller that somebody else's memory exists is itself a disclosure.
      return reply.code(404).send({ code: "NO_SUCH_MEMORY", error: "you have no memory with that id" });
    }
    return reply.send({ ok: true, forgotten: request.params.id });
  });
}
