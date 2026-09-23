import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { Config } from "../config.js";
import { registerRoomRoutes, normalisePublicRooms } from "../routes/rooms.js";
import { MemorySessionStore } from "../session.js";
import { WebharnessClient } from "../webharness/client.js";

const config: Config = {
  webharnessUrl: "https://example.test",
  port: 0,
  cookieName: "fxg_sid",
  sessionTtlMs: 60_000,
  secureCookies: false,
};

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function setup() {
  const sessions = new MemorySessionStore(60_000);
  const sid = sessions.create("Nikk2", "server-only-token");
  const app = Fastify();
  apps.push(app);
  app.register(cookie);
  registerRoomRoutes(app, config, sessions, new WebharnessClient(config.webharnessUrl));
  return { app, cookies: { fxg_sid: sid } };
}

const response = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("lobby room discovery", () => {
  it("normalises only public room facts supplied upstream", () => {
    expect(normalisePublicRooms({ rooms: [
      { roomName: " Studio ", ownerName: "Baiwei", description: "A place for sketches", onlineCount: 99, token: "secret" },
      { roomName: "hidden", ownerName: "Nikk2", visibility: "private" },
      { roomName: "not-really-public", isPublic: false },
      { roomName: " " },
      null,
    ] })).toEqual([{
      roomName: "Studio", ownerName: "Baiwei", visibility: "public", purpose: "A place for sketches",
    }]);
    expect(normalisePublicRooms([{ roomName: "Lobby" }])).toEqual([
      { roomName: "Lobby", ownerName: "", visibility: "public" },
    ]);
    expect(normalisePublicRooms({ rooms: "bad shape" })).toEqual([]);
  });

  it("returns a bare public list without exposing the upstream bearer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { rooms: [
      { roomName: "lobby", ownerName: "Nikk2", visibility: "public" },
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "GET", url: "/bff/rooms/public", cookies });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual([{ roomName: "lobby", ownerName: "Nikk2", visibility: "public" }]);
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/rooms/public");
    expect(result.body).not.toContain("server-only-token");
  });

  it("requires a session before discovery or writes", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { app } = setup();
    for (const request of [
      { method: "GET" as const, url: "/bff/rooms/public" },
      { method: "POST" as const, url: "/bff/rooms/lobby/join", payload: {} },
      { method: "POST" as const, url: "/bff/rooms/create", payload: { roomName: "new", visibility: "public" } },
    ]) {
      const result = await app.inject(request);
      expect(result.statusCode).toBe(401);
      expect(result.json().code).toBe("SESSION_EXPIRED");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("joining an existing room without silently creating one", () => {
  it("does not POST when already a member", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(200, { roomName: "Lobby" }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "POST", url: "/bff/rooms/Lobby/join", cookies, payload: {} });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ roomName: "Lobby", joined: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("only sends a join POST after a known existing room says not a member", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(403, { detail: "尚未加入该房间" }))
      .mockResolvedValueOnce(response(200, { roomName: "Lobby", created: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "POST", url: "/bff/rooms/Lobby/join", cookies, payload: { password: "one two" } });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ roomName: "Lobby", joined: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1];
    expect(url).toBe("https://example.test/api/rooms");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ roomName: "Lobby", password: "one two" });
    expect(JSON.parse(init.body)).not.toHaveProperty("visibility");
    expect(result.body).not.toContain("server-only-token");
  });

  it("never sends a join POST for a typo or missing room", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(404, { detail: "房间不存在" }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "POST", url: "/bff/rooms/misspelled/join", cookies, payload: {} });
    expect(result.statusCode).toBe(404);
    expect(result.json().code).toBe("ROOM_NOT_FOUND");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  it("does not POST after an archived room or a password challenge without a password", async () => {
    for (const [status, detail, code] of [
      [410, "房间已结束", "ROOM_ARCHIVED"],
      [403, "需要房间密码", "ROOM_PASSWORD_REQUIRED"],
    ] as const) {
      const fetchMock = vi.fn().mockResolvedValue(response(status, { detail }));
      vi.stubGlobal("fetch", fetchMock);
      const { app, cookies } = setup();
      const result = await app.inject({ method: "POST", url: "/bff/rooms/private/join", cookies, payload: {} });
      expect(result.json().code).toBe(code);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("flags an unexpected upstream creation instead of presenting it as a join", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(403, { detail: "尚未加入该房间" }))
      .mockResolvedValueOnce(response(200, { roomName: "Studio", created: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "POST", url: "/bff/rooms/Studio/join", cookies, payload: {} });
    expect(result.statusCode).toBe(409);
    expect(result.json().code).toBe("ROOM_UNEXPECTEDLY_CREATED");
    expect(result.json()).not.toHaveProperty("joined");
  });

  it("rejects a malformed password before calling upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "POST", url: "/bff/rooms/Lobby/join", cookies, payload: { password: 42 } });
    expect(result.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("explicit room creation", () => {
  it("refuses an existing room without joining it", async () => {
    for (const preflight of [response(200, { roomName: "Lobby" }), response(403, { detail: "尚未加入该房间" })]) {
      const fetchMock = vi.fn().mockResolvedValue(preflight);
      vi.stubGlobal("fetch", fetchMock);
      const { app, cookies } = setup();
      const result = await app.inject({ method: "POST", url: "/bff/rooms/create", cookies, payload: { roomName: "Lobby", visibility: "public" } });
      expect(result.statusCode).toBe(409);
      expect(result.json().code).toBe("ROOM_ALREADY_EXISTS");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it("creates only after an explicit 404 and requires created:true confirmation", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { detail: "房间不存在" }))
      .mockResolvedValueOnce(response(200, { roomName: "New studio", created: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "POST", url: "/bff/rooms/create", cookies, payload: { roomName: " New studio ", visibility: "private" } });
    expect(result.statusCode).toBe(201);
    expect(result.json()).toEqual({ roomName: "New studio", created: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://example.test/api/rooms/New%20studio");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ roomName: "New studio", visibility: "private" });
  });

  it("does not claim success when another actor took the name in the meantime", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(404, { detail: "房间不存在" }))
      .mockResolvedValueOnce(response(200, { roomName: "Studio", created: false }));
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    const result = await app.inject({ method: "POST", url: "/bff/rooms/create", cookies, payload: { roomName: "Studio", visibility: "public" } });
    expect(result.statusCode).toBe(409);
    expect(result.json().code).toBe("ROOM_ALREADY_EXISTS");
    expect(result.json()).not.toHaveProperty("created");
  });

  it("requires an explicit visibility and a valid name before an upstream read", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { app, cookies } = setup();
    for (const payload of [
      { roomName: "Studio" },
      { roomName: " ", visibility: "public" },
      { roomName: "Studio", visibility: "unlisted" },
      { roomName: "Studio", visibility: "private", password: 42 },
    ]) {
      const result = await app.inject({ method: "POST", url: "/bff/rooms/create", cookies, payload });
      expect(result.statusCode).toBe(400);
      expect(result.json().code).toBe("BAD_REQUEST");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
