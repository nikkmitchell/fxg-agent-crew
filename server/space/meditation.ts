import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { SessionStore } from "../session.js";
import { roomKey } from "../../shared/space-room.js";
import type { DatabaseSync } from "node:sqlite";
import { applyMeditation, idleMeditation, parseMeditation, type Meditation, type MeditationChange } from "../../shared/meditation.js";

/**
 * The breathing session each room shares. See shared/meditation.ts.
 *
 * STORED, so the orb a room was given is still there after a deploy. A session
 * that was running comes back as a clock that kept going while everybody's
 * bodies were dropped; it simply reads as further along, or done.
 */
export class RoomMeditations {
  constructor(private readonly database: DatabaseSync) {}
  current(room: string): Meditation {
    const row = this.database.prepare("SELECT state_json FROM space_meditation WHERE room = ?").get(roomKey(room)) as { state_json: string } | undefined;
    if (!row) return idleMeditation();
    return parseMeditation(JSON.parse(row.state_json)) ?? idleMeditation();
  }
  set(room: string, session: Meditation, by: string): void {
    this.database.prepare(
      `INSERT INTO space_meditation (room, state_json, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(room) DO UPDATE SET state_json = excluded.state_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(roomKey(room), JSON.stringify(session), by, new Date().toISOString());
  }
}

export function registerMeditationRoutes(app: FastifyInstance, options: {
  config: Config;
  sessions: SessionStore;
  meditations: RoomMeditations;
  /** Who is in the room now, so they are counted as having breathed together. */
  present: (room: string) => string[];
  announce: (room: string, meditation: Meditation) => void;
  now?: () => number;
}) {
  const requireSession = makeRequireSession(options.config, options.sessions);
  const now = options.now ?? Date.now;

  app.get("/bff/space/meditation", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ meditation: options.meditations.current(spaceRoomOf(session)), now: now() });
  });

  /**
   * START / PAUSE / RESUME / END / settings. A route rather than a socket frame
   * so a refusal has somewhere to go ("end the session before changing it").
   * `revision`, when sent, must match: two people pressing START at once should
   * not restart each other's breath.
   */
  app.post<{ Body: MeditationChange & { revision?: unknown } }>("/bff/space/meditation", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = spaceRoomOf(session);
    const before = options.meditations.current(room);
    const body = request.body ?? ({} as MeditationChange);
    if (body.revision !== undefined && body.revision !== before.revision) {
      return reply.code(409).send({ code: "STALE", error: "The session changed. Look again.", meditation: before });
    }
    const after = applyMeditation(before, body, session.username, now(), options.present(room));
    if ("refused" in after) return reply.code(422).send({ code: "REFUSED", error: after.refused, meditation: before });
    options.meditations.set(room, after, session.username);
    options.announce(room, after);
    return reply.send({ meditation: after, now: now() });
  });
}
