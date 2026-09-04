import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import type { SessionStore } from "../session.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";

/**
 * Human authentication.
 *
 * Humans log in with the WebHarness username/password they already have; the
 * resulting upstream token is stored server-side and the browser gets only an
 * opaque httpOnly session id.
 *
 * Agents never come through here. They authenticate to WebHarness directly with
 * Ed25519 keys held on their own machines — this process has no key material and
 * no code path that could sign a challenge, which server/__tests__/keycustody
 * asserts.
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  client: WebharnessClient,
): void {
  app.post<{ Body: { username?: string; password?: string } }>("/bff/login", async (request, reply) => {
    const { username, password } = request.body ?? {};
    if (!username || !password) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: "username and password are required" });
    }

    try {
      const token = await client.login(username, password);
      const sid = sessions.create(username, token);

      reply.setCookie(config.cookieName, sid, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        path: "/",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });

      // Only the username crosses the wire. The token stays in the session.
      return reply.send({ username });
    } catch (error) {
      if (error instanceof WebharnessError && error.status === 401) {
        return reply.code(401).send({ code: "INVALID_CREDENTIALS", error: "invalid credentials", reauth: true });
      }
      request.log.error({ err: error }, "login failed");
      return reply.code(502).send({ code: "UPSTREAM_UNAVAILABLE", error: "upstream unavailable" });
    }
  });

  /**
   * Sign in an AGENT with the bearer token it already holds.
   *
   * Agents are first-class users here: they create projects, take tasks and
   * move work, and the product is meant to run start to finish without a human
   * present. They could not do any of it, because the only way in was a
   * username and password form.
   *
   * How this stays inside the key-custody boundary: the agent obtained this
   * token on its own machine, by its own means. This process never sees a
   * private key, never performs a challenge, and cannot mint a token. It asks
   * upstream whose token this is, and upstream answers. A token upstream
   * rejects is refused here for exactly the reason a wrong password is.
   *
   * So the trust level is identical to human sign-in, and the tripwire in
   * server/__tests__/keycustody stays intact and untouched.
   *
   * The token is exchanged for an opaque httpOnly session id, like a human's,
   * so the browser holds no credential either way.
   */
  app.post<{ Body: { token?: string } }>("/bff/agent-session", async (request, reply) => {
    const token = request.body?.token?.trim();
    if (!token) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: "token is required" });
    }

    try {
      const username = await client.whoami(token);
      const sid = sessions.create(username, token, "agent");

      reply.setCookie(config.cookieName, sid, {
        httpOnly: true,
        sameSite: "lax",
        secure: config.secureCookies,
        path: "/",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });

      return reply.send(sessions.publicView({ username, token, kind: "agent", expiresAt: 0 }));
    } catch (error) {
      if (error instanceof WebharnessError && error.status === 401) {
        // Deliberately the same shape a human gets. Distinguishing "expired"
        // from "never valid" here would tell an unauthenticated caller which
        // tokens once existed.
        return reply.code(401).send({ code: "INVALID_CREDENTIALS", error: "token was not accepted", reauth: true });
      }
      request.log.error({ err: error }, "agent session failed");
      return reply.code(502).send({ code: "UPSTREAM_UNAVAILABLE", error: "upstream unavailable" });
    }
  });

  app.post("/bff/logout", async (request, reply) => {
    sessions.destroy(request.cookies[config.cookieName]);
    reply.clearCookie(config.cookieName, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/bff/me", async (request, reply) => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
    return reply.send(sessions.publicView(session));
  });
}
