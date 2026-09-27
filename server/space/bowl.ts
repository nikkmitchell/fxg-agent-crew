import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { bowlNote, mayStrike, type BowlStrike } from "../../shared/bowl.js";

/**
 * POST /bff/space/bowl   { note? }   strike the room's singing bowl.
 *
 * Broadcast to everyone in your room; nothing is stored. See shared/bowl.ts.
 */
export function registerBowlRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, strike: BowlStrike) => void;
  now?: () => number;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const now = deps.now ?? Date.now;
  const last = new Map<string, number>();
  app.post<{ Body: { note?: unknown } | undefined }>("/bff/space/bowl", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const at = now();
    if (!mayStrike(last, session.username, at)) {
      return reply.code(429).send({ code: "TOO_SOON", error: "let the bowl ring a moment first" });
    }
    last.set(session.username.toLowerCase(), at);
    const strike: BowlStrike = { by: session.username, at, note: bowlNote(request.body?.note) };
    deps.announce(spaceRoomOf(session), strike);
    return reply.send({ strike });
  });
}
