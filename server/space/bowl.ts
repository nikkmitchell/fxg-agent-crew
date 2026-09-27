import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { BOWLS, GONG_NOTE, SING_EVERY_MS, bowlIndex, bowlNote, bowlStrength, mayStrike, type BowlStrike } from "../../shared/bowl.js";

/**
 * POST /bff/space/bowl   { bowl?, strength?, kind?, note? }   ring a singing bowl.
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
  const struck = new Map<string, number>();
  const sung = new Map<string, number>();
  app.post<{ Body: { note?: unknown; bowl?: unknown; strength?: unknown; kind?: unknown } | undefined }>("/bff/space/bowl", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const at = now();
    const kind = request.body?.kind === "sing" ? "sing" : request.body?.kind === "gong" ? "gong" : "strike";
    const last = kind === "sing" ? sung : struck;
    if (!mayStrike(last, session.username, at, kind === "sing" ? SING_EVERY_MS : undefined)) {
      return reply.code(429).send({ code: "TOO_SOON", error: "let the bowl ring a moment first" });
    }
    last.set(session.username.toLowerCase(), at);
    const bowl = bowlIndex(request.body?.bowl);
    const strike: BowlStrike = {
      by: session.username,
      at,
      note: kind === "gong" ? GONG_NOTE : bowl === null ? bowlNote(request.body?.note) : BOWLS[bowl].note,
      ...(bowl === null || kind === "gong" ? {} : { bowl }),
      strength: bowlStrength(request.body?.strength),
      kind,
    };
    deps.announce(spaceRoomOf(session), strike);
    return reply.send({ strike });
  });
}
