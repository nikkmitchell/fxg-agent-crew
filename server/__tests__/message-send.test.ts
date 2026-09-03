import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerRoomRoutes } from "../routes/rooms.js";
import { SessionStore } from "../session.js";
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
  const sessions = new SessionStore(60_000);
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

  it.each(["", "   ", "x".repeat(2_001)])("rejects invalid content without calling upstream", async (content) => {
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
