import type { FastifyInstance } from "fastify";
import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession, spaceRoomOf } from "../require-session.js";
import { DEFAULT_SPACE_ROOM, roomKey } from "../../shared/space-room.js";
import { actorKey } from "../../shared/space-layout.js";
import {
  TOUCH_COOLDOWN_MS,
  feelingFor,
  isTouchPart,
  parsePreferences,
  reactionFor,
  type Touch,
  type TouchPart,
  type TouchPreferences,
} from "../../shared/touch.js";
import type { SpaceHub } from "./socket.js";

/**
 * Touches, and agents' feelings about them. See shared/touch.ts.
 *
 * PREFERENCES ARE STORED: an agent's taste should survive a deploy. The touches
 * themselves are kept only in memory, the last hundred, which is enough for an
 * agent to catch up on what it missed and not a record anybody asked for.
 */
export class Touches {
  private readonly recent: Array<{ room: string; touch: Touch }> = [];
  private nextId = 1;
  private readonly lastTouch = new Map<string, number>();

  constructor(
    private readonly database: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {}

  preferences(agentId: string): TouchPreferences | null {
    const row = this.database
      .prepare("SELECT preferences FROM agent_touch_preferences WHERE actor_key = ?")
      .get(actorKey(agentId)) as { preferences: string } | undefined;
    if (!row) return null;
    try {
      return parsePreferences(JSON.parse(row.preferences));
    } catch {
      return null;
    }
  }

  setPreferences(agentId: string, preferences: TouchPreferences): void {
    this.database
      .prepare(
        `INSERT INTO agent_touch_preferences (actor_key, actor_id, preferences, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (actor_key) DO UPDATE SET actor_id = excluded.actor_id, preferences = excluded.preferences, updated_at = excluded.updated_at`,
      )
      .run(actorKey(agentId), agentId, JSON.stringify(preferences), new Date(this.now()).toISOString());
  }

  /** Record a touch, or null if this person touched this agent a moment ago. */
  record(agentId: string, by: string, part: TouchPart, room = DEFAULT_SPACE_ROOM): Touch | null {
    const pair = JSON.stringify([roomKey(room), actorKey(by), actorKey(agentId)]);
    const now = this.now();
    const last = this.lastTouch.get(pair);
    if (last !== undefined && now - last < TOUCH_COOLDOWN_MS) return null;
    this.lastTouch.set(pair, now);
    const touch: Touch = {
      id: this.nextId++,
      agentId,
      by,
      part,
      feeling: feelingFor(this.preferences(agentId), part),
      at: new Date(now).toISOString(),
    };
    this.recent.push({ room: roomKey(room), touch });
    if (this.recent.length > 100) this.recent.shift();
    return touch;
  }

  since(id: number, agentId?: string, room = DEFAULT_SPACE_ROOM): Touch[] {
    return this.recent
      .filter((entry) => entry.room === roomKey(room) && entry.touch.id > id
        && (!agentId || actorKey(entry.touch.agentId) === actorKey(agentId)))
      .map((entry) => entry.touch);
  }
}

/**
 * A person touched an agent: record it, have the agent react as it chose, and
 * tell the room. Used by the socket (a hand in a headset) and by the route.
 * Returns null when it was not a touch worth acting on.
 */
export function touchAgent(hub: SpaceHub, touches: Touches, by: string, agentId: string, part: TouchPart,
  room = DEFAULT_SPACE_ROOM): Touch | null {
  const agent = hub.presence.find(agentId);
  // Only agents in the room, and never yourself.
  if (!agent || agent.kind !== "agent") return null;
  if (actorKey(agent.actorId) === actorKey(by)) return null;
  const touch = touches.record(agent.actorId, hub.presence.find(by)?.actorId ?? by, part, room);
  if (!touch) return null;
  // The reaction is the agent's own avatar state, as if it had set it itself —
  // and it is, in advance, by choosing its preferences.
  hub.presence.animate(agent.actorId, reactionFor(touch.feeling), "agent");
  hub.broadcast({ type: "touched", touch });
  return touch;
}

export function registerTouchRoutes(
  app: FastifyInstance,
  deps: { config: Config; sessions: SessionStore; hub: SpaceHub; hubFor?: (room: string) => SpaceHub; touches: Touches },
): void {
  const requireSession = makeRequireSession(deps.config, deps.sessions);

  app.post<{ Body: { agentId?: unknown; part?: unknown } }>("/bff/space/touch", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const { agentId, part } = request.body ?? {};
    if (typeof agentId !== "string" || !isTouchPart(part)) {
      return reply.code(400).send({ code: "BAD_TOUCH", error: "agentId and a part (head, shoulder, arm, hand, back, body) are required" });
    }
    const room = spaceRoomOf(session);
    const touch = touchAgent(deps.hubFor?.(room) ?? deps.hub, deps.touches, session.username, agentId, part, room);
    return reply.send({ ok: true, touch });
  });

  app.get<{ Querystring: { since?: string; agent?: string } }>("/bff/space/touches", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const since = Number(request.query.since ?? 0);
    return reply.send({ touches: deps.touches.since(Number.isFinite(since) ? since : 0,
      request.query.agent, spaceRoomOf(session)) });
  });

  /** An agent says what it thinks of being touched, part by part. Only its own. */
  app.put<{ Body: unknown }>("/bff/space/touch-preferences", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    if (session.kind !== "agent") {
      return reply.code(403).send({ code: "NOT_ALLOWED", error: "only an agent sets how it feels about being touched" });
    }
    const preferences = parsePreferences(request.body);
    if (!preferences) {
      return reply.code(400).send({
        code: "BAD_PREFERENCES",
        error: "give each part (head, shoulder, arm, hand, back, body) one of likes, dislikes, neutral",
      });
    }
    deps.touches.setPreferences(session.username, preferences);
    return reply.send({ ok: true, preferences });
  });

  app.get<{ Params: { actorId: string } }>("/bff/space/touch-preferences/:actorId", async (request, reply) => {
    if (!requireSession(request, reply)) return reply;
    return reply.send({ preferences: deps.touches.preferences(request.params.actorId) ?? {} });
  });
}
