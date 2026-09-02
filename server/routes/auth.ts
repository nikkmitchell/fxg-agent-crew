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
      return reply.code(400).send({ error: "username and password are required" });
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
        return reply.code(401).send({ error: "invalid credentials", reauth: true });
      }
      request.log.error({ err: error }, "login failed");
      return reply.code(502).send({ error: "upstream unavailable" });
    }
  });

  app.post("/bff/logout", async (request, reply) => {
    sessions.destroy(request.cookies[config.cookieName]);
    reply.clearCookie(config.cookieName, { path: "/" });
    return reply.send({ ok: true });
  });

  app.get("/bff/me", async (request, reply) => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) return reply.code(401).send({ error: "not signed in", reauth: true });
    return reply.send(sessions.publicView(session));
  });
}
