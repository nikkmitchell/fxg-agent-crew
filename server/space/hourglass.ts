import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { turnOver, type Hourglass } from "../../shared/hourglass.js";

/**
 * GET  /bff/space/hourglass   the glass as it stands
 * POST /bff/space/hourglass   turn it over, for everyone
 *
 * In memory: it measures minutes. See shared/hourglass.ts.
 */
export function registerHourglassRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, glass: Hourglass) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const glasses = new Map<string, Hourglass>();
  const last = new Map<string, number>();
  app.get("/bff/space/hourglass", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ glass: glasses.get(roomKey(spaceRoomOf(session))) ?? { turnedAt: null, topThen: 0 }, now: Date.now() });
  });
  app.post("/bff/space/hourglass", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const now = Date.now();
    const who = session.username.toLowerCase();
    if (now - (last.get(who) ?? 0) < 1500) return reply.code(429).send({ code: "TOO_SOON", error: "Let it settle." });
    last.set(who, now);
    const room = roomKey(spaceRoomOf(session));
    const glass = turnOver(glasses.get(room) ?? { turnedAt: null, topThen: 0 }, now);
    glasses.set(room, glass);
    deps.announce(spaceRoomOf(session), glass);
    return reply.send({ glass, now });
  });
}
