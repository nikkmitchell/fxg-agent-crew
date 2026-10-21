import type { FastifyRequest } from "fastify";

/**
 * WHO IS ASKING, for per-visitor limits (sign-up codes, public space feedback).
 *
 * The app does not trust proxies (no trustProxy), so behind nginx request.ip
 * is 127.0.0.1 for everybody, and one stranger's five codes would lock out
 * the whole world. nginx sets X-Real-IP (deploy/nginx.conf); it is believed
 * ONLY when the request came from the local proxy, since anyone can send that
 * header directly. signup.ts and spaces/routes.ts each had this word for word
 * until 2026-10-21; a fix to one would have left the other trusting the wrong
 * thing.
 */
export function visitorOf(request: Pick<FastifyRequest, "ip" | "headers">): string {
  const local = request.ip === "127.0.0.1" || request.ip === "::1" || request.ip === "::ffff:127.0.0.1";
  const real = request.headers["x-real-ip"];
  return local && typeof real === "string" && real ? real : request.ip;
}
