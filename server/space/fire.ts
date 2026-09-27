import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { OFFER_REST_MS, cleanOffering, type Offering } from "../../shared/fire.js";

/**
 * POST /bff/space/fire   { word }   give a word to the ember fire.
 *
 * Told to everyone in the room now, then forgotten: nothing is stored or
 * logged, because letting go is the point. See shared/fire.ts.
 */
export function registerFireRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, offering: Offering) => void;
  now?: () => number;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const now = deps.now ?? Date.now;
  const last = new Map<string, number>();
  app.post<{ Body: { word?: unknown } | undefined }>("/bff/space/fire", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const word = cleanOffering(request.body?.word);
    if (!word) return reply.code(422).send({ code: "EMPTY", error: "Give the fire a word." });
    const at = now();
    const before = last.get(session.username.toLowerCase());
    if (before !== undefined && at - before < OFFER_REST_MS) {
      return reply.code(429).send({ code: "TOO_SOON", error: "Let the last one burn first." });
    }
    last.set(session.username.toLowerCase(), at);
    deps.announce(spaceRoomOf(session), { by: session.username, word, at });
    return reply.send({ ok: true });
  });
}
