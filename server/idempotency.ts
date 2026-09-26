/**
 * A write sent twice is answered once.
 *
 * Nikk (5066): a send "was called not sent" and then arrived; pressing again
 * would have sent it twice. Lumenfold (5074): "make retries idempotent with a
 * request ID so a false error cannot duplicate an accepted send". A request
 * that carries an `idempotency-key` header is run the first time and its
 * answer kept; the same key from the same session gets that answer back,
 * without the route running again. A second copy that arrives while the first
 * is still running waits for it.
 *
 * Only answers the caller could not usefully retry are kept: a 5xx, or a
 * request that never produced an answer, leaves the key free to try again.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export const IDEMPOTENCY_HEADER = "idempotency-key";
/** Long enough to cover every retry a person makes; short enough to forget. */
export const REPLAY_FOR_MS = 2 * 60_000;
const MOST_KEPT = 2_000;
const WRITES = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type Kept = { status: number; body: string; type: string | undefined; at: number };
type Entry = { done: Kept | null; waiting: Promise<Kept | null>; finish: (kept: Kept | null) => void };

export function registerIdempotency(app: FastifyInstance, whoIs: (request: FastifyRequest) => string | null, now: () => number = Date.now): void {
  const entries = new Map<string, Entry>();
  const forget = () => {
    const cutoff = now() - REPLAY_FOR_MS;
    for (const [key, entry] of entries) {
      if (entry.done && entry.done.at < cutoff) entries.delete(key);
    }
    while (entries.size > MOST_KEPT) entries.delete(entries.keys().next().value as string);
  };
  const keyOf = (request: FastifyRequest): string | null => {
    if (!WRITES.has(request.method)) return null;
    const raw = request.headers[IDEMPOTENCY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || key.length > 200) return null;
    const who = whoIs(request);
    // Scoped to the session: nobody can collide with, or read, another
    // person's answers by guessing their key.
    return who ? `${who}\u0000${request.method}\u0000${request.url.split("?", 1)[0]}\u0000${key}` : null;
  };
  const replay = (reply: FastifyReply, kept: Kept) => {
    if (kept.type) reply.header("content-type", kept.type);
    return reply.code(kept.status).header("idempotent-replay", "true").send(kept.body);
  };

  app.addHook("onRequest", async (request, reply) => {
    const key = keyOf(request);
    if (!key) return;
    forget();
    const seen = entries.get(key);
    if (seen) {
      const kept = seen.done ?? (await seen.waiting);
      if (kept) return replay(reply, kept);
      // The first attempt produced nothing worth keeping; this one runs.
    }
    let finish: (kept: Kept | null) => void = () => {};
    const waiting = new Promise<Kept | null>((resolve) => { finish = resolve; });
    entries.set(key, { done: null, waiting, finish });
    (request as { idempotencyKey?: string }).idempotencyKey = key;
  });

  app.addHook("onSend", async (request, reply, payload) => {
    const key = (request as { idempotencyKey?: string }).idempotencyKey;
    if (!key || reply.getHeader("idempotent-replay")) return payload;
    const entry = entries.get(key);
    if (!entry) return payload;
    const body = typeof payload === "string" ? payload : Buffer.isBuffer(payload) ? payload.toString("utf8") : null;
    if (body !== null && reply.statusCode < 500) {
      const type = reply.getHeader("content-type");
      entry.done = { status: reply.statusCode, body, type: typeof type === "string" ? type : undefined, at: now() };
      entry.finish(entry.done);
    } else {
      entries.delete(key);
      entry.finish(null);
    }
    return payload;
  });

  // An answer that never got as far as onSend (the client went away) frees the key.
  app.addHook("onResponse", async (request) => {
    const key = (request as { idempotencyKey?: string }).idempotencyKey;
    const entry = key ? entries.get(key) : undefined;
    if (key && entry && !entry.done) {
      entries.delete(key);
      entry.finish(null);
    }
  });
}
