import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Message, RoomDetail, RoomSummary } from "../../shared/contracts.js";
import type { Config } from "../config.js";
import type { Session, SessionStore } from "../session.js";
import { WebharnessClient } from "../webharness/client.js";
import { classify } from "../webharness/errors.js";
import { pollMessages } from "../webharness/longpoll.js";
import { validateTransportMessage } from "../../shared/crew-events.js";
import { CHAT_MESSAGE_LIMIT, splitForChat } from "../../shared/voice.js";
import { makeRequireSession } from "../require-session.js";

/**
 * How long and how large a voice note may be.
 *
 * Sixty seconds matches what the WebHarness client allows, so a note recorded
 * in the room and one recorded at a desk obey the same rule. The byte cap is
 * generous for that minute — Opus is roughly 24 kB a second — and exists to
 * stop a broken recorder posting a hundred megabytes rather than to ration
 * anybody.
 */
const VOICE_LIMIT = { ms: 60_000, bytes: 8 * 1024 * 1024 } as const;

export function registerRoomRoutes(
  app: FastifyInstance,
  config: Config,
  sessions: SessionStore,
  client: WebharnessClient,
): void {
  const requireSession = makeRequireSession(config, sessions);

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

  /**
   * A voice note: the recording, and the words the browser heard in it.
   *
   * WHY THIS EXISTS. Speech recognition in the room used to stop when the
   * recogniser decided you had paused, and send whatever it had. Most of what
   * that loses is not misheard words — it is truncated ones, cut off mid
   * sentence. Nikk, who uses the WebHarness client daily: "it's like a start
   * and you start recording and then we stop and sends it and it also sends the
   * audio... take a look at how accurate it is."
   *
   * IT IS THE SAME RECOGNISER. WebHarness runs the browser's Web Speech API,
   * exactly as we do — its own source says so, and a clip uploaded with no text
   * comes back with none added. What is better is that YOU choose when the
   * recording ends, and that the audio arrives with it. The transcript is still
   * a guess; the difference is that now the guess is checkable, which matters
   * most in a headset where you cannot proofread before it sends.
   *
   * BASE64 IN JSON, NOT MULTIPART, and the cost is stated rather than hidden:
   * about a third more bytes on the wire. It buys not adding a dependency and a
   * body parser to this server for one route, and it lets the transcript travel
   * as an ordinary string instead of a form field. A minute of Opus is a couple
   * of hundred kilobytes; a third more of that is not worth a parser.
   */
  app.post<{
    Params: { room: string };
    Body: { audio?: string; contentType?: string; text?: string; durationMs?: number };
  }>(
    "/bff/rooms/:room/voice",
    { bodyLimit: VOICE_LIMIT.bytes },
    async (request, reply) => {
      const session = requireSession(request, reply);
      if (!session) return reply;

      const body = request.body ?? {};
      const encoded = typeof body.audio === "string" ? body.audio : "";
      if (!encoded) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "a voice note needs audio" });
      }
      const audio = Buffer.from(encoded, "base64");
      if (audio.byteLength === 0) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "that audio could not be decoded" });
      }

      const duration = Number(body.durationMs ?? 0);
      if (!Number.isFinite(duration) || duration < 0 || duration > VOICE_LIMIT.ms) {
        return reply
          .code(400)
          .send({ code: "BAD_REQUEST", error: `a voice note may be up to ${VOICE_LIMIT.ms / 1000} seconds` });
      }

      // The transcript is capped like any other message, because that is what
      // it becomes. Empty is allowed: audio with no words is the case where
      // the recording is the whole point.
      /**
       * A LONG TRANSCRIPT IS NOT A REASON TO LOSE THE RECORDING.
       *
       * This refused the whole voice note — audio included — when its
       * transcript passed two thousand characters. The first part now travels
       * with the audio and the rest follows as ordinary messages, in order, so
       * the recording and every word of the transcript both arrive.
       */
      const transcriptParts = splitForChat((body.text ?? "").trim(), CHAT_MESSAGE_LIMIT);
      const text = transcriptParts[0] ?? "";

      try {
        const sent = await client.sendVoice(session.token, request.params.room, {
          audio,
          filename: "voice.webm",
          // Trusted only as far as it is used: it labels the upload, and a
          // wrong label produces a clip that will not play rather than
          // anything that runs.
          contentType: typeof body.contentType === "string" && body.contentType.startsWith("audio/")
            ? body.contentType
            : "audio/webm",
          text,
          durationMs: duration,
        });
        for (let index = 1; index < transcriptParts.length; index += 1) {
          try {
            await client.request<Message>(
              `/api/rooms/${encodeURIComponent(request.params.room)}/messages`,
              {
                method: "POST",
                token: session.token,
                body: { content: `(transcript continued, part ${index + 1} of ${transcriptParts.length}) ${transcriptParts[index]}` },
              },
            );
          } catch {
            // The audio and the first part arrived; say plainly how much of the
            // rest did, rather than reporting the note as wholly sent.
            return reply.code(502).send({
              code: "PARTIAL",
              error: `the voice note arrived with ${index} of ${transcriptParts.length} transcript parts`,
            });
          }
        }
        return reply.send(sent);
      } catch (error) {
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
      if (!content) {
        return reply.code(400).send({ code: "BAD_REQUEST", error: "a message needs something in it" });
      }

      /**
       * POSTED IN PARTS, NOT REFUSED, when it is longer than one message.
       *
       * This refused anything over two thousand characters, which is
       * WebHarness's own ceiling and so looked like the honest thing to do.
       * It meant a long voice message was accepted by the room and bounced by
       * the chat. Nikk: "please finish the update so that it doesn't max out on
       * characters in voice messages." The ceiling is upstream's and cannot be
       * raised from here; what can be chosen is whether a long message fails or
       * arrives in order.
       *
       * STOPS AT THE FIRST PART THAT FAILS and reports how far it got, rather
       * than carrying on and leaving a hole in the middle of what was said. The
       * reply is the LAST message that arrived, which keeps the response the
       * single Message it has always been for every existing caller.
       */
      const parts = splitForChat(content, CHAT_MESSAGE_LIMIT);
      let last: Message | null = null;
      for (let index = 0; index < parts.length; index += 1) {
        try {
          const rawMessage = await client.request<Message>(
            `/api/rooms/${encodeURIComponent(request.params.room)}/messages`,
            { method: "POST", token: session.token, body: { content: parts[index] } },
          );
          const checked = validateTransportMessage(rawMessage);
          if (!checked.ok) {
            return reply.code(502).send({
              code: "UPSTREAM_UNAVAILABLE",
              error: parts.length > 1
                ? `invalid message response at part ${index + 1} of ${parts.length}`
                : "invalid message response",
            });
          }
          last = checked.value;
        } catch (error) {
          if (index === 0) return fail(reply, error);
          return reply.code(502).send({
            code: "PARTIAL",
            error: `sent ${index} of ${parts.length} parts; the rest did not arrive`,
          });
        }
      }
      return reply.send(last);
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
