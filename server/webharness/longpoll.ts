import type { Message, MessagePage } from "../../shared/contracts.js";
import type { WebharnessClient } from "./client.js";

/**
 * Long-poll passthrough for room messages.
 *
 * Two things this must get right:
 *
 * - CANCELLATION. WebHarness holds the request open for up to 30s. If the
 *   browser goes away mid-poll and we do not abort upstream, every navigation
 *   leaks a held connection for up to half a minute. The caller passes the
 *   request's abort signal straight through.
 *
 * - CURSOR HONESTY. We return the highest id actually seen, never a predicted
 *   one. An empty page returns the caller's own cursor unchanged so a reconnect
 *   cannot skip a message that landed during the gap.
 */

/** WebHarness caps `wait` at 30s; asking for more is rejected upstream. */
const MAX_WAIT_SECONDS = 30;

export type PollOptions = {
  room: string;
  token: string;
  afterId?: number;
  waitSeconds?: number;
  signal?: AbortSignal;
};

export async function pollMessages(
  client: WebharnessClient,
  { room, token, afterId, waitSeconds = 25, signal }: PollOptions,
): Promise<MessagePage> {
  const params = new URLSearchParams();
  const INITIAL_LIMIT = 50;
  if (afterId !== undefined) {
    params.set("afterId", String(afterId));
    // `wait` is only honoured alongside afterId; without a cursor the server
    // has no basis for "new", so we must not ask it to hold the connection.
    params.set("wait", String(Math.min(waitSeconds, MAX_WAIT_SECONDS)));
  } else {
    params.set("limit", String(INITIAL_LIMIT));
  }

  const path = `/api/rooms/${encodeURIComponent(room)}/messages?${params}`;
  const result = await client.request<{ roomName: string; messages: Message[] }>(path, {
    token,
    signal,
  });

  // Must be Array.isArray, not `?? []`: a malformed non-array value would
  // survive the nullish check and then throw on .reduce below.
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const highest = messages.reduce<number | null>(
    (max, message) => (max === null || message.id > max ? message.id : max),
    null,
  );

  return {
    roomName: result.roomName,
    messages,
    // Hold the caller's cursor when nothing arrived rather than inventing one.
    cursor: highest ?? afterId ?? null,
    // Only meaningful for the FIRST read of a room. A full page means we asked
    // for everything we were willing to take and it was all used up, so there
    // is probably more above — the browser needs to say so rather than present
    // a truncated transcript as the whole room.
    ...(afterId === undefined ? { mayHaveEarlier: messages.length >= INITIAL_LIMIT } : {}),
  };
}
