import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Message } from "../../shared/contracts.js";
import {
  adaptMessages,
  encodeActionRequest,
} from "../webharness/adapter.js";
import { validateActionRequest, type CrewEvent } from "../../shared/crew-events.js";
import { initialCrewState, reduceCrewEvent } from "../../src/event-core.js";
import type { Config } from "../config.js";
import type { Session, SessionStore } from "../session.js";
import type { WebharnessClient } from "../webharness/client.js";

const PAGE_LIMIT = 50;
const MAX_PAGES = 200;

/** Replay the room's durable action log. WebHarness is the persistence layer. */
export async function replayProjectState(
  client: Pick<WebharnessClient, "request">,
  room: string,
  token: string,
  canMutateProject: (username: string, roomName: string) => boolean,
) {
  const messages: Message[] = [];
  let afterId = 0;
  let complete = false;

  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await client.request<{ messages?: Message[] }>(
      `/api/rooms/${encodeURIComponent(room)}/messages?afterId=${afterId}&wait=0&limit=${PAGE_LIMIT}`,
      { token },
    );
    const batch = Array.isArray(page.messages) ? page.messages : [];
    if (batch.length === 0) { complete = true; break; }
    messages.push(...batch);
    const next = batch.reduce((highest, message) => Math.max(highest, message.id), afterId);
    if (next <= afterId) throw new Error("project replay cursor did not advance");
    afterId = next;
    if (batch.length < PAGE_LIMIT) { complete = true; break; }
  }
  if (!complete) throw new Error(`project replay exceeded ${MAX_PAGES * PAGE_LIMIT} messages`);

  const adapted = adaptMessages(messages, {
    roomName: room,
    // A valid signed-in room member may organize projects. Identity and room
    // membership still come from WebHarness; the event body cannot forge them.
    canMutateProject,
  });
  const state = adapted.events.reduce(reduceCrewEvent, initialCrewState);
  return {
    projects: Object.values(state.projects),
    tasks: Object.values(state.tasks),
    rejected: [...adapted.rejected, ...state.rejectedEvents],
  };
}

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

  app.get<{ Querystring: { room?: string } }>("/bff/projects", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = request.query.room?.trim();
    if (!room) return reply.code(400).send({ code: "BAD_REQUEST", error: "room is required" });
    return reply.send(await replayProjectState(client, room, session.token, (username) => canMutateProject(username)));
  });

  app.post<{ Body: { room?: string; payload?: CrewEvent } }>("/bff/project-events", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    const room = request.body?.room?.trim();
    const checked = validateActionRequest({ version: 1, payload: request.body?.payload });
    if (!room || !checked.ok || !["project.upserted", "task.upserted", "task.transitioned"].includes(checked.ok ? checked.value.payload.type : "")) {
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
