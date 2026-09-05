import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Message } from "../../shared/contracts.js";
import { encodeActionRequest } from "../webharness/adapter.js";
import { validateActionRequest, type CrewEvent } from "../../shared/crew-events.js";
import type { Config } from "../config.js";
import type { Session, SessionStore } from "../session.js";
import type { WebharnessClient } from "../webharness/client.js";
import { ProjectStateCache } from "../webharness/project-cache.js";


export function registerProjectRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  client: WebharnessClient,
): void {
  const requireSession = (request: FastifyRequest, reply: FastifyReply): Session | undefined => {
    const session = sessions.get(request.cookies[config.cookieName]);
    if (!session) {
      reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
      return undefined;
    }
    return session;
  };
  const canMutateProject = (username: string) => config.projectMutators.includes(username);

  /**
   * One cache per server process, keyed by room inside.
   *
   * Not per-session: the fold is over public room history and is identical for
   * every caller, so caching it per session would multiply the work by the
   * number of people looking. The authority check still runs per request over
   * the adapted events, so sharing the fold shares no privilege.
   */
  const projectCache = new ProjectStateCache(client);

  app.get<{ Querystring: { room?: string } }>("/bff/projects", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = request.query.room?.trim();
    if (!room) return reply.code(400).send({ code: "BAD_REQUEST", error: "room is required" });
    try {
      return reply.send(await projectCache.read(room, session.token, (username) => canMutateProject(username)));
    } catch (error) {
      // The cache is retained internally so the next request can still fold
      // forward, but this caller is told the read FAILED rather than handed a
      // stale projection presented as current. Serving old state silently is
      // how a board ends up confidently wrong.
      request.log.error({ err: error }, "project replay failed");
      return reply.code(503).send({
        code: "PROJECT_STATE_UNAVAILABLE",
        error: "could not read the current project log",
      });
    }
  });

  app.post<{ Body: { room?: string; payload?: CrewEvent } }>("/bff/project-events", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = request.body?.room?.trim();
    const checked = validateActionRequest({ version: 1, payload: request.body?.payload });
    if (!room || !checked.ok || !["project.upserted", "task.upserted", "task.transitioned", "task.commented"].includes(checked.ok ? checked.value.payload.type : "")) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: checked.ok ? "project action required" : checked.reason });
    }
    if (!canMutateProject(session.username)) {
      return reply.code(403).send({ code: "PROJECT_PERMISSION_REQUIRED", error: "project mutation is not permitted" });
    }
    const content = encodeActionRequest(checked.value.payload);
    if (content.length > 2_000) {
      return reply.code(400).send({ code: "BAD_REQUEST", error: "project action exceeds the 2000-character message limit" });
    }
    const message = await client.request<Message>(
      `/api/rooms/${encodeURIComponent(room)}/messages`,
      { method: "POST", token: session.token, body: { content } },
    );
    return reply.code(201).send({ messageId: message.id });
  });
}
