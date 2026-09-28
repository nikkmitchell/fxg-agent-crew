import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { BATH_SECONDS } from "../../shared/sound-bath.js";

/**
 * GET  /bff/space/sound-bath                       whether one is playing, and since when
 * POST /bff/space/sound-bath { action: start|stop } begin or end it, for everyone
 *
 * In memory: a bath lasts six minutes. See shared/sound-bath.ts.
 */
export function registerSoundBathRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, bath: { startedAt: number | null; by: string }) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const baths = new Map<string, number>();
  const playing = (room: string, now: number) => {
    const at = baths.get(room);
    if (at !== undefined && now - at < BATH_SECONDS * 1000) return at;
    baths.delete(room);
    return null;
  };
  app.get("/bff/space/sound-bath", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const now = Date.now();
    return reply.send({ startedAt: playing(roomKey(spaceRoomOf(session)), now), now });
  });
  app.post<{ Body: { action?: unknown } | undefined }>("/bff/space/sound-bath", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = roomKey(spaceRoomOf(session));
    const now = Date.now();
    if (request.body?.action === "stop") {
      baths.delete(room);
      deps.announce(spaceRoomOf(session), { startedAt: null, by: session.username });
      return reply.send({ startedAt: null, now });
    }
    if (playing(room, now) !== null) return reply.code(409).send({ code: "PLAYING", error: "A sound bath is already playing." });
    baths.set(room, now);
    deps.announce(spaceRoomOf(session), { startedAt: now, by: session.username });
    return reply.send({ startedAt: now, now });
  });
}
