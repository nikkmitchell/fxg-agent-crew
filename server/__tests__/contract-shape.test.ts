import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { SessionStore } from "../session.js";
import { WebharnessClient } from "../webharness/client.js";
import { registerRoomRoutes } from "../routes/rooms.js";
import type { Config } from "../config.js";

/**
 * These test the SHAPE the BFF actually sends, against the shape
 * shared/contracts.ts promises.
 *
 * They exist because of a bug that survived code review and 60 unit tests:
 * `/bff/rooms` was typed `RoomSummary[]` and forwarded upstream's
 * `{ rooms: [...] }` wrapper verbatim. TypeScript never objected, because
 * `client.request<T>()` casts rather than validates — the annotation was simply
 * believed. It only surfaced when the route was first run against a real
 * WebHarness instance.
 *
 * The lesson generalises: a type annotation on a network boundary is a wish,
 * not a check. Anything crossing that boundary needs a test that asserts the
 * real shape, or the contract is decorative.
 */

const config: Config = {
  webharnessUrl: "https://x.test",
  port: 0,
  cookieName: "fxg_sid",
  sessionTtlMs: 60_000,
  secureCookies: false,
};

const json = (body: unknown) => () =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

function buildApp(sessions: SessionStore) {
  const app = Fastify();
  app.register(cookie);
  registerRoomRoutes(app, config, sessions, new WebharnessClient(config.webharnessUrl));
  return app;
}

afterEach(() => vi.unstubAllGlobals());

describe("BFF response shapes match the declared contract", () => {
  it("GET /bff/rooms returns a bare array, not upstream's wrapper", async () => {
    // Exactly what the live server returns.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(json({ rooms: [{ roomName: "qa-room", ownerName: "qa" }] })));

    const sessions = new SessionStore(60_000);
    const sid = sessions.create("qa", "token");
    const app = buildApp(sessions);

    const response = await app.inject({
      method: "GET",
      url: "/bff/rooms",
      cookies: { fxg_sid: sid },
    });

    const body = response.json();
    expect(Array.isArray(body), "contract declares RoomSummary[]").toBe(true);
    expect(body[0].roomName).toBe("qa-room");
  });

  it("tolerates a bare array from upstream too", async () => {
    // Do not assume the wrapper is permanent; both shapes must work.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(json([{ roomName: "qa-room", ownerName: "qa" }])));

    const sessions = new SessionStore(60_000);
    const sid = sessions.create("qa", "token");
    const app = buildApp(sessions);

    const response = await app.inject({ method: "GET", url: "/bff/rooms", cookies: { fxg_sid: sid } });

    expect(Array.isArray(response.json())).toBe(true);
  });

  it("returns an empty array, never undefined, when upstream sends neither", async () => {
    // A UI mapping over undefined crashes; mapping over [] renders empty.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(json({})));

    const sessions = new SessionStore(60_000);
    const sid = sessions.create("qa", "token");
    const app = buildApp(sessions);

    const response = await app.inject({ method: "GET", url: "/bff/rooms", cookies: { fxg_sid: sid } });

    expect(response.json()).toEqual([]);
  });

  it("never sends the upstream token in any room response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(json({ rooms: [] })));

    const sessions = new SessionStore(60_000);
    const sid = sessions.create("qa", "super-secret-upstream-token");
    const app = buildApp(sessions);

    const response = await app.inject({ method: "GET", url: "/bff/rooms", cookies: { fxg_sid: sid } });

    expect(response.body).not.toContain("super-secret-upstream-token");
    expect(JSON.stringify(response.headers)).not.toContain("super-secret-upstream-token");
  });

  it("errors carry a code the UI can switch on", async () => {
    const sessions = new SessionStore(60_000);
    const app = buildApp(sessions);

    const response = await app.inject({ method: "GET", url: "/bff/rooms" });

    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe("SESSION_EXPIRED");
  });
});
