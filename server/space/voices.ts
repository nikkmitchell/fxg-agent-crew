import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { actorKey } from "../../shared/space-layout.js";
import { VOICES, chooseVoice, voiceFor, type Voice } from "../../shared/voice-choice.js";

/**
 * An agent's own voice.
 *
 *   GET    /bff/space/voices   what can be spoken in, and which is yours
 *   PUT    /bff/space/voice    { "voice": "am_michael" }
 *   DELETE /bff/space/voice    back to the one derived from your name
 *
 * NO ACTOR ID IN THE BODY, the same as the wardrobe: the session says who you
 * are, so you cannot put words in somebody else's voice. That is a sharper rule
 * for voices than for bodies — a room where one agent can make another SOUND
 * like itself has given up the thing the audit trail is for.
 *
 * WHETHER ANYTHING IS ACTUALLY SPOKEN IS NOT DECIDED HERE. Choosing a voice is
 * storage; synthesis is a separate seam that is absent until Kokoro is installed
 * on the box, and the room stays text-first whether or not it ever is.
 */
export class AgentVoices {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  /** The voice id this actor chose, or null if they never did. */
  chosen(actorId: string): string | null {
    const row = this.database
      .prepare("SELECT voice FROM agent_voices WHERE actor_key = ?")
      .get(actorKey(actorId)) as { voice: string } | undefined;
    return row?.voice ?? null;
  }

  /**
   * The voice to speak this actor in: their choice, else one derived from their
   * name. Never null, so no caller has to invent a fallback of its own.
   */
  voiceOf(actorId: string): Voice {
    const chosen = this.chosen(actorId);
    if (chosen) {
      const resolved = chooseVoice(chosen);
      // A stored voice that is no longer offered falls back rather than throwing:
      // the row was valid when it was written, and an engine dropping a voice is
      // not the agent's mistake to be punished for mid-sentence.
      if ("voice" in resolved) return resolved.voice;
    }
    return voiceFor(actorId);
  }

  set(actorId: string, voice: string, setBy: string): void {
    this.database
      .prepare(
        `INSERT INTO agent_voices (actor_key, actor_id, voice, set_by, set_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (actor_key) DO UPDATE SET actor_id = excluded.actor_id, voice = excluded.voice,
           set_by = excluded.set_by, set_at = excluded.set_at`,
      )
      .run(actorKey(actorId), actorId, voice, setBy, new Date(this.now()).toISOString());
  }

  clear(actorId: string): void {
    this.database.prepare("DELETE FROM agent_voices WHERE actor_key = ?").run(actorKey(actorId));
  }

  /** Who has chosen what, for a person looking at the room. */
  all(): Array<{ actorId: string; voice: string }> {
    return (
      this.database
        .prepare("SELECT actor_id, voice FROM agent_voices ORDER BY actor_id")
        .all() as Array<{ actor_id: string; voice: string }>
    ).map((row) => ({ actorId: row.actor_id, voice: row.voice }));
  }
}

export function registerVoiceRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; voices: AgentVoices; canSpeak: () => boolean },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.get("/bff/space/voices", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const mine = deps.voices.voiceOf(session.username);
    return reply.send({
      voices: VOICES,
      yours: mine.id,
      chosen: deps.voices.chosen(session.username) !== null,
      /**
       * WHETHER A VOICE WOULD ACTUALLY BE HEARD. Choosing one while nothing can
       * speak is a reasonable thing to do — but being told you have a voice when
       * the box cannot say a word is the kind of quiet untruth this project
       * keeps finding in its own notes, so the answer is here rather than
       * implied.
       */
      spokenAloud: deps.canSpeak(),
      engine: "kokoro-82M, Apache 2.0",
      heardByAnybody: false,
      note:
        "Nobody has listened to these voices yet. The descriptions come from the model's own naming, " +
        "not from an ear, exactly as the wardrobe's did before somebody looked at Crowley and found a fox.",
    });
  });

  app.put<{ Body: unknown }>("/bff/space/voice", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;

    const body = (request.body ?? {}) as Record<string, unknown>;
    const chosen = chooseVoice(body.voice);
    if ("error" in chosen) {
      return reply.code(400).send({ code: chosen.code, error: chosen.error });
    }
    deps.voices.set(session.username, chosen.voice.id, session.username);
    return reply.send({
      ok: true,
      actorId: session.username,
      voice: chosen.voice.id,
      spokenAloud: deps.canSpeak(),
    });
  });

  app.delete("/bff/space/voice", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    deps.voices.clear(session.username);
    return reply.send({ ok: true, voice: deps.voices.voiceOf(session.username).id, chosen: false });
  });
}
