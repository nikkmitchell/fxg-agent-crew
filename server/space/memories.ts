import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { actorKey } from "../../shared/space-layout.js";
import {
  attribution,
  mayRead,
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
        .prepare("SELECT id, actor_key, superseded_by FROM memories WHERE id = ?")
        .get(input.supersedes) as
          { id: string; actor_key: string; superseded_by: string | null } | undefined;

      /**
       * SOMEBODY ELSE'S MEMORY AND A MISSING ONE ANSWER THE SAME. They used to
       * differ — 403 against 404 — which told a caller that a row it cannot
       * read exists. Ids are random UUIDs so it was hard to use, and it broke
       * the rule `forget` already keeps two routes away.
       */
      if (!existing || existing.actor_key !== actorKey(actorId)) throw new Error("NO_SUCH_MEMORY");

      /**
       * REPLACING SOMETHING ALREADY REPLACED FORKS THE HISTORY, and the fork is
       * invisible: recall then returns two current opinions of the same person,
       * each looking authoritative. Pointing at the original rather than the
       * latest is the natural slip, since the original is the id you remember.
       *
       * Refused rather than quietly retargeted at the head. Retargeting would
       * write a memory the agent did not ask for, into the one store whose
       * whole point is that it says what somebody actually thinks.
       */
      if (existing.superseded_by) throw new Error(`ALREADY_REPLACED:${existing.superseded_by}`);
      supersedes = existing.id;
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

  /**
   * One memory, as `reader` may see it — their own, or somebody's shared one.
   *
   * THE READER IS AN ARGUMENT, NOT A CONVENTION. This used to return any row and
   * say in a comment that callers must check `mayRead`. Nothing called it, so
   * nothing was wrong yet; the first route to use it would have had to remember,
   * and one of them eventually would not. Not-readable and not-there answer the
   * same, as everywhere else here.
   */
  get(id: string, reader: string): Memory | null {
    const found = this.database.prepare("SELECT * FROM memories WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!found) return null;
    const memory = row(found);
    return mayRead(memory, reader) ? memory : null;
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

  /**
   * Forget one, and the versions it replaced.
   *
   * WHY THE CHAIN GOES TOO. Forgetting M2, which had replaced M1, used to leave
   * M1 current again — so deleting what you think now RESURRECTED what you used
   * to think, and recall would hand back a view the agent had deliberately
   * withdrawn. That puts words in somebody's mouth, which is the one thing this
   * store must not do.
   *
   * A chain only ever holds one agent's own rows, so nothing of anybody else's
   * is reachable from here. The count goes back in the reply rather than being
   * a surprise.
   */
  forget(actorId: string, id: string): { forgotten: boolean; alsoForgotten: number } {
    const existing = this.database.prepare("SELECT actor_key FROM memories WHERE id = ?").get(id) as
      | { actor_key: string }
      | undefined;
    if (!existing || existing.actor_key !== actorKey(actorId)) return { forgotten: false, alsoForgotten: 0 };

    // Walk back along `supersedes`, bounded: a cycle cannot be written by
    // `write`, and a loop here would hang the request rather than fail it.
    const chain: string[] = [];
    let cursor: string | null = id;
    for (let step = 0; cursor && step < 1_000; step += 1) {
      const row = this.database.prepare("SELECT supersedes FROM memories WHERE id = ?").get(cursor) as
        | { supersedes: string | null }
        | undefined;
      cursor = row?.supersedes ?? null;
      if (cursor && !chain.includes(cursor)) chain.push(cursor);
      else if (cursor) break;
    }

    // Anything newer that pointed AT this one keeps its own text and loses the
    // link: it is a later view and deleting it was not asked for.
    this.database.prepare("UPDATE memories SET supersedes = NULL WHERE supersedes = ?").run(id);
    this.database.prepare("UPDATE memories SET superseded_by = NULL WHERE superseded_by = ?").run(id);
    for (const older of chain) {
      this.database.prepare("UPDATE memories SET supersedes = NULL WHERE supersedes = ?").run(older);
      this.database.prepare("UPDATE memories SET superseded_by = NULL WHERE superseded_by = ?").run(older);
    }
    this.database.prepare("DELETE FROM memories WHERE id = ?").run(id);
    for (const older of chain) {
      this.database.prepare("DELETE FROM memories WHERE id = ?").run(older);
    }
    return { forgotten: true, alsoForgotten: chain.length };
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
      if (code.startsWith("ALREADY_REPLACED:")) {
        const head = code.slice("ALREADY_REPLACED:".length);
        return reply.code(409).send({
          code: "ALREADY_REPLACED",
          error: "that memory has already been replaced; supersede the current one instead",
          current: head,
        });
      }
      if (code === "NO_SUCH_MEMORY") {
        // Deliberately the same answer for "not there" and "not yours".
        return reply.code(404).send({ code, error: "you have no memory with that id" });
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
    const { forgotten, alsoForgotten } = deps.memories.forget(session.username, request.params.id);
    if (!forgotten) {
      // Deliberately one answer for "not yours" and "not there": telling a
      // caller that somebody else's memory exists is itself a disclosure.
      return reply.code(404).send({ code: "NO_SUCH_MEMORY", error: "you have no memory with that id" });
    }
    return reply.send({
      ok: true,
      forgotten: request.params.id,
      // The versions this one had replaced went with it, so that deleting what
      // you think now cannot resurrect what you used to think.
      alsoForgotten,
    });
  });
}
