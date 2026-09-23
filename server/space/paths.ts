import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import type { Vec3 } from "../../shared/space-layout.js";

/**
 * Walk a route: a list of places, in order, walked by the server.
 *
 *   POST   /bff/space/path   { "waypoints": [{"x":2,"z":3}, ...], "because": "..." }
 *   DELETE /bff/space/path
 *
 * THE OTHER HALF OF WAFFLE'S CARD. They asked for "a path or waypoint list the
 * server interpolates along" alongside following a moving target, having built
 * both out of a timer: re-firing a gesture every four seconds to applaud,
 * re-computing a home every two to orbit somebody. A clock inside an agent
 * drifts, stops while the agent is busy doing something else, and is invisible
 * to everybody else in the room — so the room sees an avatar twitching between
 * places with no stated reason.
 *
 * A route is one instruction with a reason attached, and presence can say how
 * much of it is left.
 *
 * WHAT IT IS NOT: teleporting. Each leg is walked at WALK_SPEED through the same
 * heading the rest of the room uses, so every waypoint still has to be walked to
 * and an agent cannot use a two-point route to cross the room instantly.
 */

const MOST_WAYPOINTS = 32;

/** Reject a route rather than sanitising it into a different one. */
function readWaypoints(value: unknown): { waypoints: Vec3[] } | { code: string; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return {
      code: "NOWHERE_TO_GO",
      error: 'send waypoints: {"waypoints":[{"x":2,"z":3},{"x":0,"z":6}]}',
    };
  }
  if (value.length > MOST_WAYPOINTS) {
    return {
      code: "TOO_MANY_WAYPOINTS",
      error: `that route has ${value.length} stops; the limit is ${MOST_WAYPOINTS}. ` +
        "A longer one is a loop, and a loop should be asked for as a loop.",
    };
  }

  const waypoints: Vec3[] = [];
  for (const [index, entry] of value.entries()) {
    const point = entry as { x?: unknown; z?: unknown };
    /**
     * A NON-FINITE COORDINATE IS REFUSED, NOT CLAMPED. clampToWorld turns a NaN
     * into 0, which is a real place in the middle of the room: an agent sent
     * somewhere undefined would walk confidently to the origin and nothing would
     * ever say why.
     */
    if (typeof point?.x !== "number" || typeof point?.z !== "number"
      || !Number.isFinite(point.x) || !Number.isFinite(point.z)) {
      return {
        code: "BAD_WAYPOINT",
        error: `waypoint ${index} needs a finite x and z`,
      };
    }
    waypoints.push({ x: point.x, y: 0, z: point.z });
  }
  return { waypoints };
}

export function registerPathRoutes(
  app: FastifyInstance,
  deps: {
    config: Config;
    sessions: SessionStore;
    walk: (
      room: string,
      actorId: string,
      kind: "human" | "agent" | null,
      waypoints: Vec3[],
      because: string | null,
    ) => { ok: true; waypoints: number; stoppedFollowing: string | null }
      | { ok: false; error: string; code: string };
    stopWalking: (room: string, actorId: string) => { remaining: number };
  },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.post<{ Body: unknown }>("/bff/space/path", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;

    const body = (request.body ?? {}) as Record<string, unknown>;
    const read = readWaypoints(body.waypoints);
    if ("code" in read) return reply.code(400).send(read);

    const because = typeof body.because === "string" && body.because.trim() ? body.because.trim() : null;
    const result = deps.walk(spaceRoomOf(session), session.username, session.kind, read.waypoints, because);
    if (!result.ok) return reply.code(409).send({ code: result.code, error: result.error });

    return reply.send({
      ok: true,
      waypoints: result.waypoints,
      because,
      // Said out loud rather than left for somebody to notice: a route replaces
      // a follow, and an agent that was walking with somebody has just stopped.
      stoppedFollowing: result.stoppedFollowing,
    });
  });

  app.delete("/bff/space/path", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const { remaining } = deps.stopWalking(spaceRoomOf(session), session.username);
    // Not an error when no route was running: stopping is a state to reach.
    return reply.send({ ok: true, abandoned: remaining });
  });
}
