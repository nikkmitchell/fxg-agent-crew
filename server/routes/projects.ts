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

/**
 * WebHarness refuses a message body over 2000 characters.
 *
 * Not a guess: posting to a room returns 422 string_too_long above it. An
 * encoded project event that exceeds it cannot be written, so it must be
 * refused HERE, before the caller is told the write succeeded — a project
 * created in the UI that never reached the log would vanish on the next
 * refresh, which is the exact failure the create/refresh test exists to catch.
 */
const MAX_TRANSPORT_CHARS = 2000;

/**
 * Replay stopped early with more history still unread.
 *
 * Thrown rather than returned, because the alternative is handing back a board
 * that is missing its oldest projects while looking complete. A partial
 * projection presented as the whole is the same class of defect as a green run
 * over a broken build: it reports something, and what it reports is wrong.
 */
export class ReplayTruncatedError extends Error {
  constructor(readonly pagesRead: number) {
    super(`project replay stopped after ${pagesRead} pages with more history remaining`);
    this.name = "ReplayTruncatedError";
  }
}

/** Replay the room's durable action log. WebHarness is the persistence layer. */
export async function replayProjectState(
  client: Pick<WebharnessClient, "request">,
  room: string,
  token: string,
  canMutateProject: (username: string, roomName: string) => boolean,
) {
  const messages: Message[] = [];
  let afterId = 0;

  let exhausted = true;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page = await client.request<{ messages?: Message[] }>(
      `/api/rooms/${encodeURIComponent(room)}/messages?afterId=${afterId}&wait=0&limit=${PAGE_LIMIT}`,
      { token },
    );
    const batch = Array.isArray(page.messages) ? page.messages : [];
    if (batch.length === 0) {
      exhausted = false;
      break;
    }
    messages.push(...batch);
    const next = batch.reduce((highest, message) => Math.max(highest, message.id), afterId);
    if (next <= afterId) throw new Error("project replay cursor did not advance");
    afterId = next;
    if (batch.length < PAGE_LIMIT) {
      exhausted = false;
      break;
    }
  }

  // Every page was full and the guard ran out: there is more history we did not
  // read. Fail loudly rather than projecting what we happened to reach.
  if (exhausted) throw new ReplayTruncatedError(MAX_PAGES);

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
    try {
      return reply.send(await replayProjectState(client, room, session.token, (username) => canMutateProject(username)));
    } catch (error) {
      if (error instanceof ReplayTruncatedError) {
        request.log.error({ err: error }, "project replay truncated");
        return reply.code(503).send({
          code: "REPLAY_TRUNCATED",
          error: "the project history is longer than this server will replay; the board would be incomplete",
        });
      }
      throw error;
    }
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
    const encoded = encodeActionRequest(checked.value.payload);
    if (encoded.length > MAX_TRANSPORT_CHARS) {
      // Refused before writing. Upstream would reject it anyway; the point is
      // that the caller learns the project was NOT created, rather than being
      // told it worked and finding it missing after a refresh.
      return reply.code(400).send({
        code: "EVENT_TOO_LARGE",
        error: `encoded event is ${encoded.length} characters; the transport limit is ${MAX_TRANSPORT_CHARS}`,
      });
    }

    const message = await client.request<Message>(
      `/api/rooms/${encodeURIComponent(room)}/messages`,
      { method: "POST", token: session.token, body: { content: encoded } },
    );
    return reply.code(201).send({ messageId: message.id });
  });
}
