import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { NOT_A_PERSON } from "../../shared/space-layout.js";
import { refusalFor, splitSpoken, type Utterance, type UtteranceInput } from "../../shared/voice.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { DEFAULT_SPACE_ROOM, roomKey } from "../../shared/space-room.js";

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
  record(actorId: string, input: UtteranceInput, room = DEFAULT_SPACE_ROOM): { utterance: Utterance } | { refused: string } {
    const refused = refusalFor(input);
    if (refused) return { refused };

    /**
     * SPLIT HERE TOO, not only in the browser.
     *
     * `planVoice` splits a long transcript before sending, which covers the
     * microphone. It does not cover an agent posting straight to this endpoint,
     * and that is how the walls of text got into the room in the first place —
     * so the rule belongs where it is enforced rather than where it is
     * convenient. Nothing is discarded: the opening is spoken and the rest
     * joins whatever written detail was already there.
     */
    const offered = input.say?.trim() ?? "";
    const spokenSplit = splitSpoken(offered);
    const say = spokenSplit.say?.trim() || null;
    const carried = [spokenSplit.detail, input.detail?.trim()].filter(Boolean).join("\n\n");
    const detail = carried || null;
    const to = input.to?.trim() || null;

    // Addressing a thing that is not a person. Refused rather than accepted and
    // dropped, because "I told the importer" should not look like it worked.
    if (to && NOT_A_PERSON.has(to)) return { refused: `${to} is not someone you can talk to` };

    const at = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO utterances (at, actor_id, to_actor, say, detail, source, confidence, room)
         VALUES (?,?,?,?,?,?,?,?)`,
      )
      .run(at, actorId, to, say, detail, input.source, input.confidence ?? null, roomKey(room));

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
  recent(limit = 50, room = DEFAULT_SPACE_ROOM): Utterance[] {
    const rows = this.db
      .prepare("SELECT * FROM utterances WHERE room = ? ORDER BY id DESC LIMIT ?")
      .all(roomKey(room), Math.max(1, Math.min(200, limit))) as Record<string, unknown>[];
    return rows.map(row).reverse();
  }

  /** One, by id, for reading a line back aloud. Null when there is no such row. */
  one(id: number, room = DEFAULT_SPACE_ROOM): Utterance | null {
    const found = this.db.prepare("SELECT * FROM utterances WHERE id = ? AND room = ?").get(id, roomKey(room)) as
      | Record<string, unknown>
      | undefined;
    return found ? row(found) : null;
  }
}

export function registerUtteranceRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  database: DatabaseSync,
  announce: (room: string, utterance: Utterance) => void,
  attend: (room: string, actorId: string, utteranceId: number | null) => void,
  spoke: (room: string, actorId: string, kind: "human" | "agent" | null) => void,
  speakTo: (
    room: string,
    actorId: string,
    kind: "human" | "agent" | null,
    targetActorId: string,
    durationMs: number,
  ) => void,
  /**
   * Start turning this line into sound now, rather than when somebody asks.
   *
   * Measured on the box: a fresh line took 6.4 seconds to come back and 1.1
   * once it was on disk, and Nikk asked for agents that "respond quickly". The
   * room already knows what was said at the moment it is said, so the wait
   * belongs here, where nobody is listening yet, instead of in front of the
   * person who pressed play. It never blocks this reply and never throws.
   */
  warmSpeech: (utterance: Utterance) => void = () => {},
): void {
  const requireSession = makeRequireSession(config, sessions);
  const utterances = new Utterances(database);

  app.post<{ Body: UtteranceInput }>("/bff/space/utterances", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;

    const body = request.body ?? ({} as UtteranceInput);
    // `source` is the caller's claim about how the words arrived, and it is
    // taken at face value — there is no way to prove a microphone was involved.
    // It is validated as one of the two allowed values so the column cannot be
    // filled with anything a reader would have to interpret.
    if (body.source !== "voice" && body.source !== "text") {
      return reply.code(400).send({ code: "BAD_SOURCE", error: "source must be 'voice' or 'text'" });
    }

    const room = spaceRoomOf(session);
    const result = utterances.record(session.username, body, room);
    if ("refused" in result) {
      // 422, not 400: the request was understood perfectly and declined on its
      // merits. The reason is the whole point — a speaker who is refused and
      // not told why will simply say it again.
      return reply.code(422).send({ code: "REFUSED", error: result.refused });
    }

    /**
     * SPEAKING COUNTS AS BEING AWAKE, whoever it was aimed at.
     *
     * This used to happen only for ADDRESSED speech, as a side effect of
     * turning the speaker toward the listener below. So an agent talking to the
     * room at large was left with whatever posture it had — which, for one that
     * had not touched the board in five minutes, is `sleeping`. It stood there
     * with its eyes shut and its words over its head.
     */
    // ONLY WHEN SOMETHING WAS ACTUALLY SAID ALOUD. A detail-only note is
    // writing, not speech, and it deliberately touches nothing in the room —
    // `space-utterances.test.ts` asserts that no gaze is invented for one, and
    // creating an occupant for a silent note would be the same kind of
    // invention by a different route.
    if (result.utterance.say) spoke(room, session.username, session.kind ?? null);
    // Only a line that was SAID is turned into sound, and the wait happens here
    // rather than in front of whoever presses play. See warmSpeech above.
    if (result.utterance.say) warmSpeech(result.utterance);

    // Match the visible speech window: short lines get a beat to be noticed,
    // while the spoken cap never leaves somebody turned for more than 14s.
    // A written-only detail has no speaking window and therefore no gaze.
    if (result.utterance.say && result.utterance.to) {
      const duration = Math.min(14_000, Math.max(6_000, 2_000 + result.utterance.say.length * 55));
      speakTo(room, session.username, session.kind ?? null, result.utterance.to, duration);
    }
    announce(room, result.utterance);
    return reply.send({ ok: true, utterance: result.utterance });
  });

  /**
   * "I am working on a reply to this."
   *
   * DECLARED BY THE ANSWERER, never inferred by the room. A person sending a
   * message and no reply arriving says nothing about whether anybody is
   * composing one — they may not have heard, may be busy, may never answer. The
   * browser shows the waiting as the LISTENER's state ("awaiting reply"), and
   * only this endpoint can put a state on the answerer.
   *
   * Renewable, and it expires by itself: a process that dies mid-thought stops
   * claiming attention within a minute rather than standing there apparently
   * deep in thought forever.
   */
  app.post<{ Body: { utteranceId?: number | null } }>(
    "/bff/space/attending",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;

      const id = request.body?.utteranceId ?? null;
      if (id !== null && !Number.isInteger(id)) {
        return reply.code(400).send({ code: "BAD_UTTERANCE", error: "utteranceId must be a whole number or null" });
      }
      // An id nobody said is refused. Declaring attention on a non-existent
      // utterance would put a state on an avatar that answers to nothing.
      if (id !== null) {
        const exists = database.prepare("SELECT 1 FROM utterances WHERE id = ? AND room = ?")
          .get(id, spaceRoomOf(session));
        if (!exists) return reply.code(404).send({ code: "NOT_FOUND", error: "no such utterance" });
      }
      attend(spaceRoomOf(session), session.username, id);
      return reply.send({ ok: true });
    },
  );

  app.get<{ Querystring: { limit?: string } }>("/bff/space/utterances", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ utterances: utterances.recent(Number(request.query.limit ?? 50), spaceRoomOf(session)) });
  });
}
