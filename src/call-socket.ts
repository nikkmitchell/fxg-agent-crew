/**
 * The site's own API requests, sent down the room's open socket.
 *
 * Nikk (5047): "add as many things as you can to socket". A headset on a poor
 * connection could still move its avatar, which rides the room's WebSocket,
 * while web requests stalled for twenty seconds (Sill measured it). So while
 * the socket is open, `requestJson` sends small /bff requests down it and the
 * server runs the very same route in-process, signed in as that socket's own
 * session (server/space/socket.ts). Chat — saha.ing relays webharness.chat —
 * comes along for free.
 *
 * NOTHING CHANGES FOR A CALLER: the answer comes back as a status and a body,
 * exactly as the web request would give them. The web request is still used
 * whenever the socket is not open, when the server says it will not tunnel
 * for this page, or when the socket closes before answering.
 */
import { isCallPath, type CallMethod, CALL_BODY_LIMIT, CALL_METHODS } from "../shared/space-wire";

type Answer = { status: number; body: string };
type CallFrame = { type: "call"; ref: string; method: CallMethod; path: string; body?: string; key?: string };
type Sender = (frame: CallFrame) => boolean;

let sender: Sender | null = null;
/** The server said this page may not tunnel (a dev origin); stop asking. */
let refused = false;
const waiting = new Map<string, { settle: (answer: Answer | null) => void }>();
let counter = 0;

/** The room socket can carry calls now, or (null) it cannot. */
export function registerCallSocket(send: Sender | null): void {
  sender = send;
  // Anything waiting on a socket that went away goes by web at once.
  if (!send) for (const one of [...waiting.values()]) one.settle(null);
}

/** A `callResult` arrived. */
export function settleCall(ref: string, status: number, body: string): void {
  waiting.get(ref)?.settle({ status, body });
}

/** How long a call may wait before it is given up: a long poll gets its wait and more. */
export function callDeadline(path: string): number {
  const wait = Number(new URL(path, "http://x").searchParams.get("wait") ?? 0);
  return (Number.isFinite(wait) && wait > 0 ? wait * 1000 : 0) + 20_000;
}

/**
 * Send one request down the socket. Resolves with the answer, or null when it
 * should go by web instead: no socket, not a call the socket takes, the socket
 * closed first, or this page was refused.
 */
export function callOverSocket(path: string, init: RequestInit): Promise<Answer | null> {
  const method = (init.method ?? "GET").toUpperCase() as CallMethod;
  if (!sender || refused) return Promise.resolve(null);
  if (!CALL_METHODS.includes(method) || !isCallPath(path)) return Promise.resolve(null);
  if (init.body !== undefined && init.body !== null && typeof init.body !== "string") return Promise.resolve(null);
  if (typeof init.body === "string" && init.body.length > CALL_BODY_LIMIT) return Promise.resolve(null);
  if (init.signal?.aborted) return Promise.reject(new DOMException("aborted", "AbortError"));

  counter += 1;
  const ref = `c${Date.now().toString(36)}${counter}`;
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (answer: Answer | null, error?: unknown) => {
      if (done) return;
      done = true;
      waiting.delete(ref);
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(answer);
    };
    const onAbort = () => finish(null, new DOMException("aborted", "AbortError"));
    const timer = setTimeout(
      () => finish({ status: 504, body: JSON.stringify({ code: "NO_ANSWER", error: "no answer yet: it may still arrive, check before trying again" }) }),
      callDeadline(path),
    );
    init.signal?.addEventListener("abort", onAbort);
    waiting.set(ref, {
      settle: (answer) => {
        if (answer && answer.status === 403 && answer.body.includes("CROSS_SITE")) {
          refused = true;
          return finish(null);
        }
        finish(answer);
      },
    });
    const key = new Headers(init.headers).get("idempotency-key") ?? undefined;
    const frame: CallFrame = {
      type: "call", ref, method, path,
      ...(typeof init.body === "string" ? { body: init.body } : {}),
      ...(key ? { key } : {}),
    };
    if (!sender?.(frame)) finish(null);
  });
}

/** For tests: forget everything. */
export function resetCallSocket(): void {
  sender = null;
  refused = false;
  for (const one of [...waiting.values()]) one.settle(null);
}

/**
 * An idempotency key for one message: the same parts always give the same
 * key, so sending the same words again within two minutes is answered with
 * the first answer instead of being posted twice (server/idempotency.ts).
 */
export function sendKey(...parts: string[]): string {
  // FNV-1a over the joined parts: short, stable, and not a secret.
  let hash = 0x811c9dc5;
  const text = parts.join("\u0000");
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `send-${hash.toString(36)}-${text.length}`;
}
