import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { BOAT_REST_MS, afloat, type Boat } from "../../shared/boats.js";

/**
 * GET  /bff/space/boats          the boats still afloat on this room's pond
 * POST /bff/space/boats           set one on the water, for everyone
 *
 * In memory: a boat floats for minutes. See shared/boats.ts.
 */
export function registerBoatRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, boat: Boat) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const ponds = new Map<string, Boat[]>();
  const last = new Map<string, number>();
  app.get("/bff/space/boats", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = roomKey(spaceRoomOf(session));
    const now = Date.now();
    const sky = afloat(ponds.get(room) ?? [], now);
    ponds.set(room, sky);
    return reply.send({ boats: sky, now });
  });
  app.post<{ Body: unknown }>("/bff/space/boats", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const now = Date.now();
    const who = session.username.toLowerCase();
    if (now - (last.get(who) ?? 0) < BOAT_REST_MS) return reply.code(429).send({ code: "TOO_SOON", error: "Let the last one sail first." });
    last.set(who, now);
    const room = roomKey(spaceRoomOf(session));
    const boat: Boat = { id: randomUUID().slice(0, 8), by: session.username, at: now, seed: Math.random() };
    ponds.set(room, afloat([...(ponds.get(room) ?? []), boat], now));
    deps.announce(spaceRoomOf(session), boat);
    return reply.send({ boat, now });
  });
}
