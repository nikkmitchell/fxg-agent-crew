import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Message, RoomDetail, RoomSummary } from "../../shared/contracts.js";
import type { Config } from "../config.js";
import type { Session, SessionStore } from "../session.js";
import { WebharnessClient } from "../webharness/client.js";
import { classify } from "../webharness/errors.js";
import { pollMessages } from "../webharness/longpoll.js";
import { validateTransportMessage } from "../../shared/crew-events.js";

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
      reply.code(401).send({ code: "SESSION_EXPIRED", error: "not signed in", reauth: true });
      return undefined;
    }
    return session;
  };

  /**
   * Upstream failures are translated into stable codes rather than forwarded
   * verbatim, so the UI never branches on a Chinese detail string or on a 403
   * that means three different things. A 401 reaching here has already survived
   * the client's retry, so it genuinely means re-authenticate.
   */
  const fail = (reply: FastifyReply, error: unknown) => {
    const { code, status, detail } = classify(error);
    return reply.code(status).send({
      code,
      error: detail,
      ...(code === "SESSION_EXPIRED" ? { reauth: true } : {}),
    });
  };

  app.get("/bff/rooms", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    try {
      // Upstream wraps this as { rooms: [...] }. Unwrap it here rather than
      // leaking the wrapper: shared/contracts.ts promises RoomSummary[], and a
      // BFF whose responses do not match its own declared contract is worse
      // than no contract, because the UI is written against the lie.
      //
      // Nothing caught this in review or in 60 unit tests, because
      // client.request<T>() only casts — there is no runtime validation, so
      // TypeScript happily believed the annotation. It surfaced the first time
      // the route was run against a real server.
      const payload = await client.request<{ rooms?: RoomSummary[] } | RoomSummary[]>(
        "/api/rooms",
        { token: session.token },
      );
      // `?? []` only guards null/undefined. If upstream sends {rooms:"oops"}
      // that string would pass straight through and break the array contract
      // this PR exists to fix — the annotation is not the check.
      const nested = Array.isArray(payload) ? payload : payload.rooms;
      const rooms = Array.isArray(nested) ? nested : [];
      return reply.send(rooms);
    } catch (error) {
      return fail(reply, error);
    }
  });

  app.get<{ Params: { room: string } }>("/bff/rooms/:room", async (request, reply) => {
    const session = requireSession(request, reply);
    if (!session) return reply;
    try {
      // `client.request<T>()` CASTS. It does not check. The same mistake was
      // already found and fixed on /bff/rooms — the type annotation made
      // everyone, including sixty tests, believe a shape nobody had verified —
      // and this route was left doing exactly the same thing.
      //
      // It is not theoretical. Against an upstream that omits `onlineUsers`,
      // the panel reached `state.room.onlineUsers.length`, threw, and React
      // unmounted the whole tree: a BLANK PAGE with the error only in a console
      // nobody has open. Found by running the app against a server I control,
      // which is the only way this class of bug ever shows up.
      const raw = await client.request<unknown>(
        `/api/rooms/${encodeURIComponent(request.params.room)}`,
        { token: session.token },
      );
      const detail = normaliseRoomDetail(raw, request.params.room);
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
      const explicitAfterId = afterIdRaw === undefined ? undefined : Number(afterIdRaw);
      if (explicitAfterId !== undefined && !Number.isFinite(explicitAfterId)) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "afterId must be a number" });
      }

      try {
        const page = await pollMessages(client, {
          room: request.params.room,
          token: session.token,
          // Only the browser knows whether it retained the transcript that
          // precedes a cursor. With no explicit afterId, fetch initial history;
          // silently substituting a server cursor would render an empty page
          // after a browser reload.
          afterId: explicitAfterId,
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

  app.post<{ Params: { room: string }; Body: { content?: string } }>(
    "/bff/rooms/:room/messages",
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;
      const content = request.body?.content?.trim();
      if (!content || content.length > 2_000) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "message must be between 1 and 2000 characters" });
      }

      try {
        const rawMessage = await client.request<Message>(
          `/api/rooms/${encodeURIComponent(request.params.room)}/messages`,
          { method: "POST", token: session.token, body: { content } },
        );
        const checked = validateTransportMessage(rawMessage);
        if (!checked.ok) {
          return reply.code(502).send({ code: "UPSTREAM_UNAVAILABLE", error: "invalid message response" });
        }
        return reply.send(checked.value);
      } catch (error) {
        return fail(reply, error);
      }
    },
  );
}

/**
 * Rebuild a RoomDetail from whatever upstream actually sent.
 *
 * REBUILT, not spread: `{ ...raw }` would carry through any extra field and
 * still leave the missing ones missing. Every property here is either checked
 * or replaced with a value that is honest about not knowing.
 *
 * The choice on a missing `onlineUsers` is an empty list rather than an error.
 * Presence is decoration around a transcript; refusing to open a room because
 * nobody could be counted would turn a cosmetic gap into an outage. An empty
 * list renders "0 online / Nobody else is here right now", which is what the
 * BFF genuinely knows. Fabricating a count would be the worse failure — this
 * screen exists to not do that.
 */
export function normaliseRoomDetail(raw: unknown, roomName: string): RoomDetail {
  const source = (raw ?? {}) as Record<string, unknown>;
  const text = (value: unknown, fallback: string) =>
    typeof value === "string" && value.trim() ? value : fallback;

  const onlineUsers = Array.isArray(source.onlineUsers)
    ? source.onlineUsers
        .filter((user): user is Record<string, unknown> => !!user && typeof user === "object")
        .filter((user) => typeof user.username === "string")
        .map((user) => ({
          username: user.username as string,
          lastSeenAt: text(user.lastSeenAt, ""),
        }))
    : [];

  return {
    roomName: text(source.roomName, roomName),
    ownerName: text(source.ownerName, ""),
    onlineUsers,
    // Trust a number upstream gave us; otherwise count what we can actually
    // see. Never a guess dressed as a measurement.
    onlineCount: typeof source.onlineCount === "number" && Number.isFinite(source.onlineCount)
      ? source.onlineCount
      : onlineUsers.length,
    isOwner: source.isOwner === true,
    muted: source.muted === true,
    ...(source.myPermissions && typeof source.myPermissions === "object"
      ? {
          myPermissions: {
            canSpeak: (source.myPermissions as Record<string, unknown>).canSpeak === true,
            canUpload: (source.myPermissions as Record<string, unknown>).canUpload === true,
          },
        }
      : {}),
  };
}
