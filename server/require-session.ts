import type { FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "./config.js";
import type { Session, SessionStore } from "./session.js";

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
