import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { NOT_A_PERSON } from "../../shared/space-layout.js";
import { refusalFor, type Utterance, type UtteranceInput } from "../../shared/voice.js";

/**
 * What is said in the room.
 *
 * Two things happen to an utterance: it is written down, and — if it has a
 * spoken part — it is announced to everybody currently connected so their
 * clients can read it aloud. The writing down is the part that matters; the
 * announcement is a convenience that a reconnecting client makes up for by
 * fetching the recent ones.
 */

const row = (record: Record<string, unknown>): Utterance => ({
  id: record.id as number,
  at: record.at as string,
  actorId: record.actor_id as string,
  to: (record.to_actor as string | null) ?? null,
  say: (record.say as string | null) ?? null,
  detail: (record.detail as string | null) ?? null,
  source: record.source as "voice" | "text",
  confidence: (record.confidence as number | null) ?? null,
});

export class Utterances {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Record something said. Throws nothing — the caller is handed the refusal so
   * it can say it back in the speaker's own terms.
   */
  record(actorId: string, input: UtteranceInput): { utterance: Utterance } | { refused: string } {
    const refused = refusalFor(input);
    if (refused) return { refused };

    const say = input.say?.trim() || null;
    const detail = input.detail?.trim() || null;
    const to = input.to?.trim() || null;

    // Addressing a thing that is not a person. Refused rather than accepted and
    // dropped, because "I told the importer" should not look like it worked.
    if (to && NOT_A_PERSON.has(to)) return { refused: `${to} is not someone you can talk to` };

    const at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO utterances (at, actor_id, to_actor, say, detail, source, confidence)
         VALUES (?,?,?,?,?,?,?)`,
      )
      .run(at, actorId, to, say, detail, input.source, input.confidence ?? null);

    const inserted = this.db
      .prepare("SELECT * FROM utterances WHERE id = last_insert_rowid()")
      .get() as Record<string, unknown>;
    return { utterance: row(inserted) };
  }

  /**
   * The last few, oldest first so a client can render them in order.
   *
   * Everything, not just what was aimed at you: the room is a shared place and
   * a conversation you can see half of is worse than one you can see none of.
   */
  recent(limit = 50): Utterance[] {
    const rows = this.db
      .prepare("SELECT * FROM utterances ORDER BY id DESC LIMIT ?")
      .all(Math.max(1, Math.min(200, limit))) as Record<string, unknown>[];
    return rows.map(row).reverse();
  }
}

export function registerUtteranceRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  database: DatabaseSync,
  announce: (utterance: Utterance) => void,
): void {
  const utterances = new Utterances(database);

  app.post<{ Body: UtteranceInput }>("/bff/space/utterances", async (request, reply) => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in" });

    const body = request.body ?? ({} as UtteranceInput);
    // `source` is the caller's claim about how the words arrived, and it is
    // taken at face value — there is no way to prove a microphone was involved.
    // It is validated as one of the two allowed values so the column cannot be
    // filled with anything a reader would have to interpret.
    if (body.source !== "voice" && body.source !== "text") {
      return reply.code(400).send({ code: "BAD_SOURCE", error: "source must be 'voice' or 'text'" });
    }

    const result = utterances.record(session.username, body);
    if ("refused" in result) {
      // 422, not 400: the request was understood perfectly and declined on its
      // merits. The reason is the whole point — a speaker who is refused and
      // not told why will simply say it again.
      return reply.code(422).send({ code: "REFUSED", error: result.refused });
    }

    announce(result.utterance);
    return reply.send({ ok: true, utterance: result.utterance });
  });

  app.get<{ Querystring: { limit?: string } }>("/bff/space/utterances", async (request, reply) => {
    if (!sessions.get(request.cookies[config.cookieName])) {
      return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in" });
    }
    return reply.send({ utterances: utterances.recent(Number(request.query.limit ?? 50)) });
  });
}
