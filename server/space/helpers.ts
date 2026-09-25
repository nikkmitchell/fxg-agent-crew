import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { roomKey } from "../../shared/space-room.js";
import { liveHelpers, parseHelpers, type Helper, type HelperReport } from "../../shared/helpers.js";

/**
 * Each room's helper reports, in memory. See shared/helpers.ts.
 *
 * IN MEMORY ON PURPOSE: a helper lives minutes, and a report that survived a
 * restart would describe processes that may no longer exist.
 */
export class RoomHelpers {
  private readonly rooms = new Map<string, Record<string, HelperReport>>();
  /** The last live set each room was told, so a sweep only speaks on change. */
  private readonly told = new Map<string, string>();

  report(room: string, actorId: string, helpers: Helper[], now: number): void {
    const key = roomKey(room);
    const reports = { ...(this.rooms.get(key) ?? {}) };
    if (helpers.length === 0) delete reports[actorId];
    else reports[actorId] = { helpers, at: now };
    this.rooms.set(key, reports);
  }

  live(room: string, now: number): Record<string, Helper[]> {
    return liveHelpers(this.rooms.get(roomKey(room)) ?? {}, now);
  }

  /** Rooms whose live set has changed since they were last told, with that set. */
  changed(now: number): { room: string; helpers: Record<string, Helper[]> }[] {
    const out: { room: string; helpers: Record<string, Helper[]> }[] = [];
    for (const key of this.rooms.keys()) {
      const helpers = this.live(key, now);
      const said = JSON.stringify(helpers);
      if (this.told.get(key) === said) continue;
      this.told.set(key, said);
      out.push({ room: key, helpers });
    }
    return out;
  }

  markTold(room: string, helpers: Record<string, Helper[]>): void {
    this.told.set(roomKey(room), JSON.stringify(helpers));
  }
}

export function registerHelperRoutes(app: FastifyInstance, options: {
  config: Config;
  sessions: SessionStore;
  helpers: RoomHelpers;
  announce: (room: string, helpers: Record<string, Helper[]>) => void;
  now?: () => number;
}) {
  const requireSession = makeRequireSession(options.config, options.sessions);
  const now = options.now ?? Date.now;

  app.get("/bff/space/helpers", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ helpers: options.helpers.live(spaceRoomOf(session), now()) });
  });

  /**
   * YOUR OWN HELPERS ONLY: the identity is the session's, never a field in the
   * body, so no one can put spirits round somebody else. Send the whole list
   * each time; an empty list clears it. Keep sending while they work, or the
   * report expires (HELPERS_TTL_MS).
   */
  app.post<{ Body: unknown }>("/bff/space/helpers", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const parsed = parseHelpers(request.body);
    if ("refused" in parsed) return reply.code(400).send({ code: "BAD_HELPERS", error: parsed.refused });
    const room = spaceRoomOf(session);
    options.helpers.report(room, session.username, parsed.helpers, now());
    const live = options.helpers.live(room, now());
    options.helpers.markTold(room, live);
    options.announce(room, live);
    return reply.send({ helpers: live });
  });
}
