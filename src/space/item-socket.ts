/**
 * Room-item moves over the room's socket, with the web request as the fallback.
 *
 * Nikk (5026): on a poor connection "go is almost unplayable, but Baiwei can
 * still see my avatar moving". The avatar rides the room's WebSocket, which
 * stays open; a Go move was a separate web request, and in a headset those
 * were measured stalling for twenty seconds while the socket kept flowing
 * (Sill). So a move goes over the socket when it is open, and the server runs
 * the very same function the web route does (server/space/items.ts).
 *
 * SAFE TO FALL BACK. Every Go move carries the table's revision. If the socket
 * does not answer in time the move is sent again as a web request; had the
 * first one landed after all, the revision has moved on and the server refuses
 * the second as "The table changed" — never a second stone.
 */
import { ApiError } from "../api-request";

type Answer = { status: number; payload: Record<string, unknown> };
type Sender = (message: { type: "itemAction"; ref: string; id: string; body: Record<string, unknown> }) => boolean;

let sender: Sender | null = null;
const waiting = new Map<string, { resolve: (answer: Answer) => void; timer: ReturnType<typeof setTimeout> }>();
let counter = 0;

/** How long to wait for the socket before trying the web request instead. */
export const SOCKET_ANSWER_MS = 4_000;

/** The room socket says it can carry moves (or, with null, that it cannot). */
export function registerItemSocket(send: Sender | null): void {
  sender = send;
  if (!send) for (const ref of [...waiting.keys()]) settle(ref, null);
}

/** An `itemActionResult` arrived for `ref`; null means the socket went away. */
export function settleItemAction(ref: string, answer: Answer | null): void {
  settle(ref, answer);
}

function settle(ref: string, answer: Answer | null) {
  const one = waiting.get(ref);
  if (!one) return;
  waiting.delete(ref);
  clearTimeout(one.timer);
  one.resolve(answer ?? { status: 0, payload: {} });
}

/**
 * Send over the socket and wait for its answer. Resolves `null` when the
 * socket is not open or did not answer in time, which means: use the web.
 */
function overSocket(id: string, body: Record<string, unknown>, waitMs: number): Promise<Answer | null> {
  if (!sender) return Promise.resolve(null);
  counter += 1;
  const ref = `${Date.now().toString(36)}-${counter}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => settle(ref, null), waitMs);
    waiting.set(ref, { resolve: (answer) => resolve(answer.status === 0 ? null : answer), timer });
    if (!sender?.({ type: "itemAction", ref, id, body })) settle(ref, null);
  });
}

/**
 * One move: over the socket if it can, else (or if it did not answer) the web.
 * Answers and refusals come back in exactly the shape the web request gives,
 * so nothing that calls this can tell which way the move went.
 */
export async function actOnItem<T>(
  id: string,
  body: Record<string, unknown>,
  web: () => Promise<T>,
  waitMs = SOCKET_ANSWER_MS,
): Promise<T> {
  const answer = await overSocket(id, body, waitMs);
  if (!answer) return web();
  if (answer.status >= 200 && answer.status < 300) return answer.payload as T;
  const refusal = answer.payload as { error?: string; code?: string };
  throw new ApiError(refusal.error ?? `the server refused this (${answer.status})`, answer.status, refusal.code ?? "UNKNOWN");
}
