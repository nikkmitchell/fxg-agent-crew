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
export async function pollMessages(client, { room, token, afterId, waitSeconds = 25, signal }) {
    const params = new URLSearchParams();
    if (afterId !== undefined) {
        params.set("afterId", String(afterId));
        // `wait` is only honoured alongside afterId; without a cursor the server
        // has no basis for "new", so we must not ask it to hold the connection.
        params.set("wait", String(Math.min(waitSeconds, MAX_WAIT_SECONDS)));
    }
    else {
        params.set("limit", "50");
    }
    const path = `/api/rooms/${encodeURIComponent(room)}/messages?${params}`;
    const result = await client.request(path, {
        token,
        signal,
    });
    // Must be Array.isArray, not `?? []`: a malformed non-array value would
    // survive the nullish check and then throw on .reduce below.
    const messages = Array.isArray(result.messages) ? result.messages : [];
    const highest = messages.reduce((max, message) => (max === null || message.id > max ? message.id : max), null);
    return {
        roomName: result.roomName,
        messages,
        // Hold the caller's cursor when nothing arrived rather than inventing one.
        cursor: highest ?? afterId ?? null,
    };
}
//# sourceMappingURL=longpoll.js.map