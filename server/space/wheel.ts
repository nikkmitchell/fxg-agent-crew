import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { PUSH_REST_MS, pushStrength, type WheelPush } from "../../shared/wheel.js";

/**
 * GET  /bff/space/wheel               how many times this room's wheel has turned
 * POST /bff/space/wheel  { strength } push it round, for everyone
 *
 * The count is kept in memory: it is a count of turns since the server started,
 * and says so. See shared/wheel.ts.
 */
export function registerWheelRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, push: WheelPush) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const turns = new Map<string, number>();
  const last = new Map<string, number>();
  app.get("/bff/space/wheel", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ turns: turns.get(roomKey(spaceRoomOf(session))) ?? 0 });
  });
  app.post<{ Body: { strength?: unknown } | undefined }>("/bff/space/wheel", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const now = Date.now();
    const who = session.username.toLowerCase();
    if (now - (last.get(who) ?? 0) < PUSH_REST_MS) return reply.code(429).send({ code: "TOO_SOON", error: "Let it turn." });
    last.set(who, now);
    const room = roomKey(spaceRoomOf(session));
    const count = (turns.get(room) ?? 0) + 1;
    turns.set(room, count);
    const push: WheelPush = { by: session.username, strength: pushStrength(request.body?.strength), turns: count };
    deps.announce(spaceRoomOf(session), push);
    return reply.send({ push });
  });
}
