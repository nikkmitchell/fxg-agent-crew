import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { DRIFT_REST_MS, cleanDrift, type Drift } from "../../shared/driftwood.js";

/**
 * POST /bff/space/driftwood   { word }   write a word on driftwood.
 *
 * Told to everyone in the room now, then forgotten: nothing is stored or
 * logged: the sea takes it. See shared/driftwood.ts.
 */
export function registerDriftRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, drift: Drift) => void;
  now?: () => number;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const now = deps.now ?? Date.now;
  const last = new Map<string, number>();
  app.post<{ Body: { word?: unknown } | undefined }>("/bff/space/driftwood", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const word = cleanDrift(request.body?.word);
    if (!word) return reply.code(422).send({ code: "EMPTY", error: "Write a word on the wood." });
    const at = now();
    const before = last.get(session.username.toLowerCase());
    if (before !== undefined && at - before < DRIFT_REST_MS) {
      return reply.code(429).send({ code: "TOO_SOON", error: "Let the last one float away first." });
    }
    last.set(session.username.toLowerCase(), at);
    deps.announce(spaceRoomOf(session), { by: session.username, word, at });
    return reply.send({ ok: true });
  });
}
