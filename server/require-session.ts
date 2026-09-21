import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { Session, SessionStore } from "./session.js";
import { DEFAULT_SPACE_ROOM, roomKey } from "../shared/space-room.js";

/**
 * Resolve the session, or answer 401 and return undefined.
 *
 * ONE COPY. This existed three times over in `server/routes` — board, projects
 * and rooms each had their own identical closure — and `server/space` had none,
 * so its eight routes inlined the same three lines instead. Twelve places
 * spelling out the same rule is twelve places for one of them to drift, and the
 * one that drifts is a route that answers 200 to somebody signed out.
 *
 * `reauth: true` is part of the contract, not decoration: the client uses it to
 * tell "your session expired, sign in again" from "you may not do that", which
 * are different screens.
 */
export function makeRequireSession(config: Config, sessions: SessionStore) {
  return (request: FastifyRequest, reply: FastifyReply): Session | undefined => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) {
      reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
      return undefined;
    }
    return session;
  };
}

/**
 * Which room's space this session is standing in.
 *
 * ONE PLACE THAT RESOLVES THE DEFAULT. Every space route needs this, and if
 * each one wrote `session.spaceRoom ?? "saha.ing"` then changing the default
 * would mean finding twenty of them and missing one — and the one missed would
 * put somebody in a different room from the rest of their own session, which
 * shows a half-empty space with nothing to explain it.
 */
export const spaceRoomOf = (session: Pick<Session, "spaceRoom">): string =>
  roomKey(session.spaceRoom ?? DEFAULT_SPACE_ROOM);
