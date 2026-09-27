import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { LANTERN_REST_MS, cleanWord, stillAloft, type Lantern } from "../../shared/lantern.js";

/**
 * GET  /bff/space/lanterns          the lanterns still in this room's sky
 * POST /bff/space/lanterns { word } release one, for everyone
 *
 * In memory: a lantern lives minutes, not days. See shared/lantern.ts.
 */
export function registerLanternRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, lantern: Lantern) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const skies = new Map<string, Lantern[]>();
  const last = new Map<string, number>();
  app.get("/bff/space/lanterns", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = roomKey(spaceRoomOf(session));
    const now = Date.now();
    const sky = stillAloft(skies.get(room) ?? [], now);
    skies.set(room, sky);
    return reply.send({ lanterns: sky, now });
  });
  app.post<{ Body: { word?: unknown } | undefined }>("/bff/space/lanterns", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const now = Date.now();
    const who = session.username.toLowerCase();
    if (now - (last.get(who) ?? 0) < LANTERN_REST_MS) return reply.code(429).send({ code: "TOO_SOON", error: "Watch the last one rise first." });
    last.set(who, now);
    const room = roomKey(spaceRoomOf(session));
    const lantern: Lantern = { id: randomUUID().slice(0, 8), by: session.username, word: cleanWord(request.body?.word), at: now, seed: Math.random() };
    skies.set(room, stillAloft([...(skies.get(room) ?? []), lantern], now));
    deps.announce(spaceRoomOf(session), lantern);
    return reply.send({ lantern, now });
  });
}
