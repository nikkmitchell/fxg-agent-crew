import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerRoomRoutes } from "../routes/rooms.js";
import { MemorySessionStore } from "../session.js";
import { WebharnessClient } from "../webharness/client.js";
import type { Config } from "../config.js";

const config: Config = {
  webharnessUrl: "https://example.test",
  port: 0,
  cookieName: "fxg_sid",
  sessionTtlMs: 60_000,
  secureCookies: false,
};

function setup() {
  const sessions = new MemorySessionStore(60_000);
  const sid = sessions.create("nikk", "upstream-secret");
  const app = Fastify();
  app.register(cookie);
  registerRoomRoutes(app, config, sessions, new WebharnessClient(config.webharnessUrl));
  return { app, sid };
}

afterEach(() => vi.unstubAllGlobals());

describe("POST /bff/rooms/:room/messages", () => {
  it("sends through the server-side token and returns the confirmed message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 8, username: "nikk", content: "hello", msgType: "text",
      createdAt: "2026-09-03T04:00:00Z", updatedAt: "2026-09-03T04:00:00Z", streaming: false,
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, sid } = setup();
    const response = await app.inject({ method: "POST", url: "/bff/rooms/A%2FB/messages", cookies: { fxg_sid: sid }, payload: { content: " hello " } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: 8, content: "hello" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/api/rooms/A%2FB/messages");
    expect(init.headers.Authorization).toBe("Bearer upstream-secret");
    expect(response.body).not.toContain("upstream-secret");
  });

  it("sends a message longer than one WebHarness message in parts, in order, losing nothing", async () => {
    /**
     * THIS USED TO BE REFUSED with a 400 — `"x".repeat(2_001)` sat in the
     * table below alongside the empty strings as "invalid content". Two
     * thousand characters is WebHarness's ceiling and cannot be raised from
     * here, but refusing meant a long voice message reached the room and
     * bounced off the chat. Nikk: "please finish the update so that it doesn't
     * max out on characters in voice messages."
     */
    let id = 100;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      const content = JSON.parse(init.body).content as string;
      id += 1;
      return new Response(JSON.stringify({
        id, username: "nikk", content, msgType: "text",
        createdAt: "2026-09-03T04:00:00Z", updatedAt: "2026-09-03T04:00:00Z", streaming: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { app, sid } = setup();
    const long = Array.from({ length: 120 }, (_, i) => `Sentence ${i + 1} of a long dictated message.`).join(" ");
    expect(long.length).toBeGreaterThan(2_000);

    const response = await app.inject({
      method: "POST", url: "/bff/rooms/AgentParty/messages", cookies: { fxg_sid: sid }, payload: { content: long },
    });
    expect(response.statusCode).toBe(200);

    const sent = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).content as string);
    expect(sent.length).toBeGreaterThan(1);
    for (const part of sent) expect(part.length).toBeLessThanOrEqual(2_000);
    expect(sent.join(" "), "every word, in order").toBe(long);
    // The reply is still one Message — the last to arrive — for every caller
    // that already expects exactly that.
    expect(response.json()).toMatchObject({ id: 100 + sent.length });
  });

  it("stops at the first part that fails and says how far it got", async () => {
    // Carrying on after a failure would post part three with part two missing:
    // a hole in the middle of what somebody said that nobody is told about.
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (_url: string, init: { body: string }) => {
      calls += 1;
      if (calls === 2) return new Response("upstream down", { status: 503 });
      return new Response(JSON.stringify({
        id: calls, username: "nikk", content: JSON.parse(init.body).content, msgType: "text",
        createdAt: "2026-09-03T04:00:00Z", updatedAt: "2026-09-03T04:00:00Z", streaming: false,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }));
    const { app, sid } = setup();
    const long = Array.from({ length: 200 }, (_, i) => `Sentence ${i + 1} of a long dictated message.`).join(" ");
    const response = await app.inject({
      method: "POST", url: "/bff/rooms/AgentParty/messages", cookies: { fxg_sid: sid }, payload: { content: long },
    });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("PARTIAL");
    expect(response.json().error).toMatch(/sent 1 of \d+ parts/);
    expect(calls, "nothing after the failed part").toBe(2);
  });

  it.each(["", "   "])("rejects empty content without calling upstream", async (content) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { app, sid } = setup();
    const response = await app.inject({ method: "POST", url: "/bff/rooms/AgentParty/messages", cookies: { fxg_sid: sid }, payload: { content } });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("BAD_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed when upstream returns a shape that is not a message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const { app, sid } = setup();
    const response = await app.inject({ method: "POST", url: "/bff/rooms/AgentParty/messages", cookies: { fxg_sid: sid }, payload: { content: "hello" } });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("does not forward a partially valid upstream message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 8, username: "nikk", content: "hello", msgType: "text",
      createdAt: "not-a-time", updatedAt: "2026-09-03T04:00:00Z", streaming: false,
    }), { status: 200 })));
    const { app, sid } = setup();
    const response = await app.inject({ method: "POST", url: "/bff/rooms/AgentParty/messages", cookies: { fxg_sid: sid }, payload: { content: "hello" } });
    expect(response.statusCode).toBe(502);
    expect(response.json().code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
