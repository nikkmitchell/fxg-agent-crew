import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { actorKey, clampToWorld, deskFor } from "../../shared/space-layout.js";
import { normaliseRotation } from "../../shared/panel-place.js";
import { resolveFacing, type AgentHome, type HomeSummary, type Spot } from "../../shared/agent-home.js";
import { roomKey } from "../../shared/space-room.js";

/**
 * Agents' saved home positions. See shared/agent-home.ts for what was asked.
 *
 * STORED, unlike presence. Where somebody is standing right now is honestly
 * unknown after a restart; where an agent LIVES is a decision a person made,
 * and it should still be true tomorrow.
 *
 * Without a row, an agent's home is its desk, exactly as before.
 *
 * PER ROOM SINCE MIGRATION 27. Where you stand belongs to the room you are
 * standing in — your desk in one is not your desk in another — so `room` is the
 * first argument of every method rather than state on the instance. Explicit
 * because the compiler then names every caller that has not thought about it,
 * which for a change this wide is the only way to be sure none was missed.
 */
export class AgentHomes {
  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  get(room: string, actorId: string): AgentHome | null {
    const row = this.database
      .prepare("SELECT x, z, facing FROM agent_homes WHERE room = ? AND actor_key = ?")
      .get(roomKey(room), actorKey(actorId)) as { x: number; z: number; facing: number } | undefined;
    return row ? { at: { x: row.x, y: 0, z: row.z }, facing: row.facing } : null;
  }

  set(room: string, actorId: string, home: AgentHome, setBy: string): AgentHome {
    const at = clampHome(home.at);
    const facing = normaliseRotation(home.facing);
    this.database
      .prepare(
        `INSERT INTO agent_homes (room, actor_key, actor_id, x, z, facing, set_by, set_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (room, actor_key) DO UPDATE SET actor_id = excluded.actor_id, x = excluded.x, z = excluded.z,
           facing = excluded.facing, set_by = excluded.set_by, set_at = excluded.set_at`,
      )
      .run(roomKey(room), actorKey(actorId), actorId, at.x, at.z, facing, setBy, new Date(this.now()).toISOString());
    return { at, facing };
  }

  clear(room: string, actorId: string): void {
    this.database.prepare("DELETE FROM agent_homes WHERE room = ? AND actor_key = ?")
      .run(roomKey(room), actorKey(actorId));
  }

  all(room: string): HomeSummary[] {
    return (
      this.database
        .prepare("SELECT actor_id AS actorId, x, z, facing, set_by AS setBy, set_at AS setAt FROM agent_homes WHERE room = ? ORDER BY actor_id")
        .all(roomKey(room)) as { actorId: string; x: number; z: number; facing: number; setBy: string; setAt: string }[]
    ).map((row) => ({ actorId: row.actorId, at: { x: row.x, y: 0, z: row.z }, facing: row.facing, setBy: row.setBy, setAt: row.setAt }));
  }
}

/**
 * A home can be ANYWHERE A PERSON CAN WALK, which since Nikk asked for the
 * walking limit to come off means anywhere at all.
 *
 * It used to be clamped to the room. That would have quietly broken the main
 * thing homes are for the moment the rail came off: "come and stand over here
 * with me" is the request, and a person standing thirty metres out would have
 * had their agent dragged back to the old wall and left there. Only the
 * arithmetic bound remains — see WORLD in shared/space-layout.ts.
 */
export function clampHome(at: { x: number; z: number }): { x: number; y: number; z: number } {
  return clampToWorld(at);
}

/** Home for an agent: its saved place in THIS room if it has one, else its desk. */
export function homeOf(room: string, homes: Pick<AgentHomes, "get"> | null, actorId: string): { at: { x: number; y: number; z: number }; facing: number | null } {
  const saved = homes?.get(room, actorId) ?? null;
  return saved ?? { at: deskFor(actorId), facing: null };
}

export function registerHomeRoutes(
  app: FastifyInstance,
  deps: {
    config: Config;
    sessions: SessionStore;
    homes: AgentHomes;
    /** What the actors table, or failing that the live room, says this actor is. */
    kindOf: (actorId: string) => "human" | "agent" | null;
    /**
     * Walk the agent to its new home now, rather than at its next idle moment.
     *
     * A PLACEMENT IS AN EXPLICIT INSTRUCTION, so it ends a follow or a route the
     * agent was on, and returns which. Both routes below put that in the reply:
     * an agent that stops walking with somebody because you placed it is a side
     * effect you should be told about, not one you should have to notice.
     */
    goHome: (
      actorId: string,
      home: { at: { x: number; y: number; z: number }; facing: number | null },
    ) => { stoppedFollowing: string | null; abandonedRoute: number };
    /**
     * Where somebody is standing, for `face: "<name>"`. The server is the only
     * party that knows this AND has the formula right, which is the whole
     * reason a caller is allowed to name a person instead of an angle.
     */
    whereIs: (actorId: string) => Spot | null;
    /** Who is in the room, so a misspelled name comes back with the real ones. */
    whoIsHere: () => string[];
  },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.get("/bff/space/homes", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    return reply.send({ homes: deps.homes.all(spaceRoomOf(session)) });
  });

  /**
   * Who may place an agent. A PERSON may place any agent: that is the request,
   * people in the room directing where agents work. An AGENT may place only
   * itself — choosing its own spot — and never another agent. Nobody places a
   * person: a person stands where their own headset says.
   */
  const allowed = (session: { username: string; kind?: string | null }, actorId: string): string | null => {
    if (deps.kindOf(actorId) !== "agent") return `${actorId} is not an agent, and only agents are placed`;
    if (session.kind === "agent" && actorKey(session.username) !== actorKey(actorId)) {
      return "an agent may choose its own home, not another agent's";
    }
    return null;
  };

  app.put<{ Params: { actorId: string }; Body: { x?: unknown; z?: unknown; facing?: unknown; face?: unknown } }>(
    "/bff/space/homes/:actorId",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const refusal = allowed(session, request.params.actorId);
      if (refusal) return reply.code(403).send({ code: "NOT_ALLOWED", error: refusal });
      const { x, z } = request.body ?? {};
      if (![x, z].every((value) => typeof value === "number" && Number.isFinite(value))) {
        return reply.code(400).send({ code: "BAD_HOME", error: "x and z must be numbers" });
      }
      /**
       * Bounded BEFORE the facing is worked out. There is no wall to be pushed
       * off any more, but a garbage coordinate still gets pulled to something
       * finite, and an angle measured from the spot that was ASKED for would
       * then be measured from somewhere the agent is not actually standing.
       */
      const at = clampHome({ x: x as number, z: z as number });
      const asked = resolveFacing(request.body ?? {}, at, deps.whereIs, deps.whoIsHere, request.params.actorId);
      if ("error" in asked) return reply.code(400).send({ code: "BAD_HOME", error: asked.error });
      const home = deps.homes.set(
        spaceRoomOf(session),
        request.params.actorId,
        { at, facing: asked.facing },
        session.username,
      );
      const ended = deps.goHome(request.params.actorId, home);
      return reply.send({ ok: true, home, ...ended });
    },
  );

  app.delete<{ Params: { actorId: string } }>("/bff/space/homes/:actorId", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const refusal = allowed(session, request.params.actorId);
    if (refusal) return reply.code(403).send({ code: "NOT_ALLOWED", error: refusal });
    deps.homes.clear(spaceRoomOf(session), request.params.actorId);
    const ended = deps.goHome(request.params.actorId, homeOf(spaceRoomOf(session), null, request.params.actorId));
    return reply.send({ ok: true, ...ended });
  });
}
