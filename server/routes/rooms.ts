import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { RoomDetail, RoomSummary } from "../../shared/contracts.js";
import type { Config } from "../config.js";
import type { Session, SessionStore } from "../session.js";
import { WebharnessClient, WebharnessError } from "../webharness/client.js";
import { pollMessages } from "../webharness/longpoll.js";

export function registerRoomRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  client: WebharnessClient,
): void {
  /** Resolve the session or answer 401; returns undefined once it has replied. */
  const requireSession = (request: FastifyRequest, reply: FastifyReply): Session | undefined => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) {
      reply.code(401).send({ error: "not signed in", reauth: true });
      return undefined;
    }
    return session;
  };

  /**
   * Upstream failures are translated rather than forwarded verbatim: a 401 from
   * WebHarness has already survived the client's single retry, so by the time it
   * reaches here it genuinely means re-authenticate.
   */
  const fail = (reply: FastifyReply, error: unknown) => {
    if (error instanceof WebharnessError) {
      if (error.status === 401) return reply.code(401).send({ error: error.detail, reauth: true });
      if (error.status === 403) return reply.code(403).send({ error: error.detail });
      if (error.status === 404) return reply.code(404).send({ error: error.detail });
      if (error.status === 410) return reply.code(410).send({ error: "room archived" });
    }
    return reply.code(502).send({ error: "upstream unavailable" });
  };

  app.get("/bff/rooms", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    try {
      const rooms = await client.request<RoomSummary[]>("/api/rooms", { token: session.token });
      return reply.send(rooms);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { room: string } }>("/bff/rooms/:room", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    try {
      const detail = await client.request<RoomDetail>(
        `/api/rooms/${encodeURIComponent(request.params.room)}`,
        { token: session.token },
      );
      return reply.send(detail);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { room: string }; Querystring: { afterId?: string; wait?: string } }>(
    "/bff/rooms/:room/messages",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;

      // Cancel the upstream long-poll when the browser goes away, rather than
      // leaving a held connection for up to 30s per abandoned request.
      const controller = new AbortController();
      request.raw.on("close", () => controller.abort());

      const afterIdRaw = request.query.afterId;
      const afterId = afterIdRaw === undefined ? undefined : Number(afterIdRaw);
      if (afterId !== undefined && !Number.isFinite(afterId)) {
        return reply.code(400).send({ error: "afterId must be a number" });
      }

      try {
        const page = await pollMessages(client, {
          room: request.params.room,
          token: session.token,
          afterId,
          waitSeconds: request.query.wait === undefined ? 25 : Number(request.query.wait),
          signal: controller.signal,
        });
        return reply.send(page);
      } catch (error) {
        // An abort is the client leaving, not a failure worth reporting.
        if (controller.signal.aborted) return reply;
        return fail(reply, error);
      }
    },
  );
}
