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
  /**
   * Record who just signed in, with the kind upstream holds for them.
   *
   * WHY. Nikk: KANxD was "trying to share the view for Vint, but there is no
   * option". The share page offers only actors saha.ing knows to be agents,
   * and an actor's kind was learned only from a board write. Vint had signed
   * in and joined the room, done nothing on the board yet, and so was on file
   * with no kind — present, and not offered. Upstream already knows which
   * accounts are agents; asking it at sign-in means a new agent can have its
   * screen shared from its first minute. A kind already on file is never
   * overwritten.
   */
  onIdentified: (username: string, kind: "human" | "agent") => void = () => {},
  /**
   * Enrol an agent into the boards of the rooms it is actually in.
   *
   * Nikk: "lets have the agent auto add themselves to whatever project they
   * happen to be in the webharness.chat group chat for", and yes on 2026-09-19
   * to that carrying board writes in a public room. Every new agent used to
   * meet PROJECT_PERMISSION_REQUIRED on its first card and hand it to somebody
   * else to file — Waffle to Sill, and Nightjar could not board a night's work.
   *
   * THE ROOMS ARE THE ONES UPSTREAM CONFIRMS, never a list the caller sent: see
   * WebharnessClient.rooms. What a link grants, and what it can never grant, is
   * BoardStore.enrolFromRoom.
   */
  enrolFromRooms: (actorId: string, kind: "human" | "agent" | null, rooms: string[]) => string[] = () => [],
): void {
  const record = (username: string, kind: "human" | "agent" | null) => {
    if (!kind) return;
    try {
      onIdentified(username, kind);
    } catch {
      // Signing in must not fail because a bookkeeping write did.
    }
  };
  /**
   * Enrol whoever holds this token into the projects of the rooms they are in.
   *
   * BEST EFFORT, ON PURPOSE, in every caller: being locked out of the site
   * because a question about a BOARD could not be answered would be a worse
   * failure than the one this fixes. An upstream that cannot answer leaves the
   * person signed in and un-enrolled, which is where they were before.
   */
  const enrolFromToken = async (
    username: string,
    kind: "human" | "agent" | null,
    token: string,
    log: { warn: (details: object, message: string) => void },
  ): Promise<void> => {
    try {
      enrolFromRooms(username, kind, await client.rooms(token));
    } catch (error) {
      log.warn({ err: error }, "could not check room membership for enrolment");
    }
  };

  /**
   * Sessions already checked for rooms since this process started. /bff/me is
   * asked on every page load; the rooms need asking once per session, not once
   * per page. Bounded by the sessions one process sees, which is a handful.
   */
  const roomsChecked = new Set<string>();

  app.post<{ Body: { username?: string; password?: string } }>("/bff/login", async (request, reply) => {
    const { username, password } = request.body ?? {};
    if (!username || !password) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: "username and password are required" });
    }

    try {
      const token = await client.login(username, password);
      const sid = sessions.create(username, token);
      roomsChecked.add(sid);

      /**
       * A PERSON IN THE ROOM IS ENROLLED EXACTLY AS AN AGENT IS.
       *
       * This line was only ever in /bff/agent-session, so every agent in
       * saha.ing got the saha.ing board at sign-in and every PERSON who signed
       * in with a password got PROJECT_PERMISSION_REQUIRED on their first card.
       * Baiwei, in the room, could not edit the board in it. Nikk: "why can't
       * baiwei access the workboard, anyone who is here should be able to
       * access". Same rooms, asked of WebHarness with this person's own token;
       * same link table; same refusal to re-add anybody a manager revoked.
       *
       * AWAITED, like the agent's, so the first edit after signing in works.
       */
      await enrolFromToken(username, null, token, request.log);
      // Best effort: the sign-in has already succeeded, and not knowing the
      // kind only means it is learned later, as before.
      void client
        .identify(token)
        .then((identity) => record(identity.username, identity.kind))
        .catch(() => undefined);

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
      const { username, kind } = await client.identify(token);
      const sid = sessions.create(username, token, "agent");
      roomsChecked.add(sid);
      record(username, kind);

      /**
       * BEING IN THE ROOM IS THE CLAIM TO THAT ROOM'S BOARD, and the claim is
       * checked here rather than believed: the rooms come from WebHarness,
       * asked with this agent's own token.
       *
       * BEST EFFORT, ON PURPOSE. An agent locked out of the room because a
       * question about the BOARD could not be answered would be a worse
       * failure than the one this fixes, so an upstream that cannot answer
       * leaves the agent signed in and un-enrolled — the state it was in
       * before, and the next sign-in tries again.
       */
      await enrolFromToken(username, kind, token, request.log);

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
    const sid = request.cookies[config.cookieName];
    const session = sessions.get(sid);
    if (!session) return reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });

    /**
     * SESSIONS THAT PREDATE THE FIX HEAL ON THEIR NEXT PAGE LOAD. A session
     * lasts days, so enrolling only at sign-in would leave everybody already
     * signed in — Baiwei included — locked out until they happened to sign out.
     * Once per session, and NOT awaited: nobody's page waits on it.
     */
    if (sid && !roomsChecked.has(sid)) {
      roomsChecked.add(sid);
      void enrolFromToken(session.username, null, session.token, request.log);
    }
    return reply.send(sessions.publicView(session));
  });
}
