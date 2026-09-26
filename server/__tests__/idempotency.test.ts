import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { REPLAY_FOR_MS, registerIdempotency } from "../idempotency.js";

/**
 * Lumenfold (5074): "make retries idempotent with a request ID so a false
 * error cannot duplicate an accepted send". Nikk (5066): a send was called
 * not sent, then arrived.
 */
const build = (now: () => number = Date.now) => {
  const app = Fastify();
  let posted = 0;
  let failNext = false;
  registerIdempotency(app, (request) => (request.headers.cookie ?? "").replace(/^sid=/, "") || null, now);
  app.post("/bff/rooms/x/messages", async (_request, reply) => {
    if (failNext) {
      failNext = false;
      return reply.code(502).send({ error: "upstream down" });
    }
    posted += 1;
    return reply.code(201).send({ id: posted });
  });
  return { app, posted: () => posted, failNext: () => { failNext = true; } };
};
const send = (app: ReturnType<typeof build>["app"], key: string | null, sid = "a") =>
  app.inject({
    method: "POST",
    url: "/bff/rooms/x/messages",
    headers: { cookie: `sid=${sid}`, ...(key ? { "idempotency-key": key } : {}) },
    payload: { content: "hi" },
  });

describe("a write sent twice is answered once", () => {
  it("posts once and gives the retry the first answer, after an accepted write the client never heard", async () => {
    const { app, posted } = build();
    const first = await send(app, "k1");
    // The client saw a false error here and tries again with the same key.
    const again = await send(app, "k1");
    expect(posted()).toBe(1);
    expect(again.statusCode).toBe(201);
    expect(again.json()).toEqual(first.json());
    expect(again.headers["idempotent-replay"]).toBe("true");
  });

  it("makes a copy that arrives while the first is still running wait for it", async () => {
    const { app, posted } = build();
    const [a, b] = await Promise.all([send(app, "k2"), send(app, "k2")]);
    expect(posted()).toBe(1);
    expect(a.json()).toEqual(b.json());
  });

  it("lets a server failure be retried for real", async () => {
    const { app, posted, failNext } = build();
    failNext();
    expect((await send(app, "k3")).statusCode).toBe(502);
    expect((await send(app, "k3")).statusCode).toBe(201);
    expect(posted()).toBe(1);
  });

  it("keeps each session's keys apart, runs keyless writes every time, and forgets after a while", async () => {
    let clock = 1_000;
    const { app, posted } = build(() => clock);
    await send(app, "same", "a");
    await send(app, "same", "b");
    expect(posted()).toBe(2);
    await send(app, null);
    await send(app, null);
    expect(posted()).toBe(4);
    clock += REPLAY_FOR_MS + 1;
    await send(app, "same", "a");
    expect(posted()).toBe(5);
  });
});
