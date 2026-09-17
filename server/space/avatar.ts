import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { makeRequireSession } from "../require-session.js";
import { parseAvatarControl, type AvatarControl, type AvatarState } from "../../shared/avatar-motion.js";

/**
 * A convenient control surface for headless agents.
 *
 * The websocket accepts the same control, but an agent doing a short unit of
 * work should not need to hold a renderer socket open merely to nod or wave.
 * Authentication supplies identity, and the callback therefore cannot target
 * another actor.
 */
export function registerAvatarRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  animate: (
    actorId: string,
    kind: "human" | "agent" | null,
    control: AvatarControl,
  ) => AvatarState,
): void {
  const requireSession = makeRequireSession(config, sessions);

  app.post<{ Body: unknown }>("/bff/space/avatar", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const control = parseAvatarControl(request.body);
    if (!control) {
      return reply.code(400).send({
        code: "BAD_AVATAR_CONTROL",
        error: "provide mood (neutral, happy, focused, concerned), gesture (none, wave, nod, present, clap, shrug, disagree) and/or posture; holdMs, if given, must be a positive number of milliseconds",
      });
    }
    return reply.send({ ok: true, avatar: animate(session.username, session.kind, control) });
  });
}
