import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { LIGHT_REST_MS, burning, freeSlot, type Stick } from "../../shared/incense.js";

/**
 * GET  /bff/space/incense   the sticks burning in this room
 * POST /bff/space/incense   light one, for everyone
 *
 * In memory: a stick burns for minutes. See shared/incense.ts.
 */
export function registerIncenseRoutes(app: FastifyInstance, deps: {
  config: Config;
  sessions: SessionStore;
  announce: (room: string, sticks: Stick[]) => void;
}): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);
  const bowls = new Map<string, Stick[]>();
  const last = new Map<string, number>();
  app.get("/bff/space/incense", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = roomKey(spaceRoomOf(session));
    const now = Date.now();
    const sticks = burning(bowls.get(room) ?? [], now);
    bowls.set(room, sticks);
    return reply.send({ sticks, now });
  });
  app.post("/bff/space/incense", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const now = Date.now();
    const who = session.username.toLowerCase();
    if (now - (last.get(who) ?? 0) < LIGHT_REST_MS) return reply.code(429).send({ code: "TOO_SOON", error: "Let the last one catch first." });
    const room = roomKey(spaceRoomOf(session));
    const sticks = burning(bowls.get(room) ?? [], now);
    const slot = freeSlot(sticks);
    if (slot === null) return reply.code(422).send({ code: "FULL", error: "The bowl is full; wait for one to burn down." });
    last.set(who, now);
    const next = [...sticks, { id: randomUUID().slice(0, 8), by: session.username, at: now, slot }];
    bowls.set(room, next);
    deps.announce(spaceRoomOf(session), next);
    return reply.send({ sticks: next, now });
  });
}
