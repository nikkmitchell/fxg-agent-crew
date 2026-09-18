import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";

/**
 * Walk with somebody.
 *
 * Nikk: "I want to be able to add a follow user ability, so i can walk down the
 * street in AR with my agent walking beside me". Waffle had asked for the same
 * thing from inside the room, having built it out of a timer that re-sent a home
 * every couple of seconds and finding it chased rather than accompanied.
 *
 * ONE INSTRUCTION, NOT A LOOP. The agent says who it is walking with; the server
 * recomputes the spot beside them every tick. That keeps the two rules the room
 * already has — an agent does not teleport itself, and movement has a stated
 * reason — while removing the timer nobody could get right from outside.
 *
 * IDENTITY COMES FROM THE SESSION, so `actor` names who to FOLLOW and never who
 * is following. There is deliberately no way to make somebody else walk with
 * you: that would be the room's first mechanism for moving another actor, and it
 * would arrive in the same shape as "an agent can dress another agent", which
 * this project already refuses.
 */
export function registerFollowingRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  follow: (
    actorId: string,
    kind: "human" | "agent" | null,
    targetId: string,
    side: "left" | "right" | null,
    because: string | null,
  ) => { ok: true; side: "left" | "right" } | { ok: false; error: string; code: string },
  stopFollowing: (actorId: string) => { was: string | null },
): void {
  const requireSession = makeRequireSession(config, sessions);

  app.post<{ Body: unknown }>("/bff/space/follow", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;

    const body = (request.body ?? {}) as Record<string, unknown>;
    const actor = typeof body.actor === "string" ? body.actor.trim() : "";
    if (!actor) {
      return reply.code(400).send({
        code: "BAD_FOLLOW",
        error: 'name who to walk with: {"actor":"Nikk2"}, optionally {"side":"left"|"right","because":"..."}',
      });
    }

    // An unrecognised side is refused rather than defaulted. Silently putting an
    // agent on the other shoulder from the one that was asked for is the kind of
    // ignored instruction somebody spends an hour looking for.
    const side = body.side === undefined || body.side === null
      ? null
      : body.side === "left" || body.side === "right"
        ? body.side
        : "bad";
    if (side === "bad") {
      return reply.code(400).send({ code: "BAD_SIDE", error: 'side must be "left" or "right"' });
    }

    const because = typeof body.because === "string" && body.because.trim() ? body.because.trim() : null;
    const result = follow(session.username, session.kind, actor, side, because);
    if (!result.ok) {
      // 409 rather than 400: nothing is wrong with the request, the room is not
      // in a state where it can be honoured.
      return reply.code(409).send({ code: result.code, error: result.error });
    }
    return reply.send({ ok: true, following: actor, side: result.side, because });
  });

  app.delete("/bff/space/follow", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const { was } = stopFollowing(session.username);
    // Not an error when nothing was being followed: "stop" is a state to reach,
    // not an event, and a retry after a dropped reply must not fail.
    return reply.send({ ok: true, stoppedFollowing: was });
  });
}
