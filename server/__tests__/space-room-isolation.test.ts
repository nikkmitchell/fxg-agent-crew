import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import type { ServerMessage } from "../../shared/space-wire.js";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "../db/schema.js";
import { BoardStore } from "../db/store.js";

const running: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const close of running.splice(0)) await close();
  vi.unstubAllGlobals();
});

function joinedRooms(roomsByToken: Record<string, string[]>) {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    const token = String((options?.headers as Record<string, string>)?.Authorization ?? "").replace(/^Bearer /, "");
    return new Response(JSON.stringify({ rooms: (roomsByToken[token] ?? []).map((roomName) => ({ roomName })) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));
}

async function boot() {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  await built.app.listen({ host: "127.0.0.1", port: 0 });
  running.push(async () => void (await built.app.close()));
  const address = built.app.server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const as = (username: string, token: string) =>
    `${built.config.cookieName}=${built.sessions.create(username, token, "human")}`;
  const enter = (cookie: string, roomName: unknown) => built.app.inject({
    method: "POST",
    url: "/bff/space/enter",
    headers: { cookie },
    payload: { roomName },
  });
  return { ...built, as, enter, origin: `ws://127.0.0.1:${address.port}` };
}

async function connect(origin: string, cookie: string) {
  const socket = new WebSocket(`${origin}/bff/space/socket`, { headers: { cookie } } as never);
  const frames: ServerMessage[] = [];
  socket.addEventListener("message", (event) => frames.push(JSON.parse(String(event.data)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("websocket failed")), { once: true });
  });
  const until = async (wanted: (frame: ServerMessage) => boolean) => {
    const end = Date.now() + 3_000;
    while (Date.now() < end) {
      const found = frames.find(wanted);
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`missing frame; saw ${frames.map((frame) => frame.type).join(", ")}`);
  };
  running.push(async () => { socket.close(); });
  return { socket, frames, until };
}

describe("entering and isolating room spaces", () => {
  it("does not expose the legacy default space to a new session before room membership is checked", async () => {
    joinedRooms({ newcomer: ["lobby"] });
    const { sessions, config, app, enter } = await boot();
    const cookie = `${config.cookieName}=${sessions.createUnselected("Newcomer", "newcomer")}`;
    for (const url of ["/bff/space/room", "/bff/space/presence", "/bff/space/items", "/bff/space/utterances"]) {
      const denied = await app.inject({ method: "GET", url, headers: { cookie } });
      expect(denied.statusCode, url).toBe(403);
      expect(denied.json().code, url).toBe("ROOM_NOT_SELECTED");
    }
    // Choosing a body is personal and works at the front door.
    expect((await app.inject({ method: "GET", url: "/bff/space/bodies", headers: { cookie } })).statusCode).toBe(200);
    expect((await enter(cookie, "saha.ing")).statusCode).toBe(403);
    expect((await enter(cookie, "lobby")).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/bff/space/room", headers: { cookie } })).json())
      .toEqual({ roomName: "lobby" });
  });

  it("uses current upstream membership rather than a public room name to enter", async () => {
    joinedRooms({ token: ["saha.ing"] });
    const { as, enter, sessions, config, app } = await boot();
    const cookie = as("Moraine", "token");
    const sid = cookie.slice(`${config.cookieName}=`.length);

    expect((await app.inject({ method: "GET", url: "/bff/space/room" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/bff/space/room", headers: { cookie } })).json())
      .toEqual({ roomName: "saha.ing" });

    expect((await enter(cookie, "other-room")).statusCode).toBe(403);
    expect(sessions.get(sid)?.spaceRoom).toBeUndefined();
    expect((await enter(cookie, " ")).statusCode).toBe(400);
    expect(sessions.get(sid)?.spaceRoom).toBeUndefined();
    expect((await enter(cookie, " SAHA.ING ")).json()).toEqual({ roomName: "saha.ing" });
    expect(sessions.get(sid)?.spaceRoom).toBe("saha.ing");
    const current = await app.inject({ method: "GET", url: "/bff/space/room", headers: { cookie } });
    expect(current.json()).toEqual({ roomName: "saha.ing" });
    expect(current.headers["cache-control"]).toBe("no-store");
  });

  it("keeps presence, snapshots and call setup inside each joined room", async () => {
    joinedRooms({ alpha: ["alpha"], beta: ["beta"] });
    const { as, enter, app, origin } = await boot();
    const a = as("Aster", "alpha");
    const b = as("Beryl", "beta");
    expect((await enter(a, "alpha")).statusCode).toBe(200);
    expect((await enter(b, "beta")).statusCode).toBe(200);

    const alpha = await connect(origin, a);
    const beta = await connect(origin, b);
    const alphaWelcome = await alpha.until((frame) => frame.type === "welcome");
    const betaWelcome = await beta.until((frame) => frame.type === "welcome");
    if (alphaWelcome.type !== "welcome" || betaWelcome.type !== "welcome") throw new Error("no welcome");
    expect(alphaWelcome.people.map((person) => person.actorId)).toEqual(["Aster"]);
    expect(betaWelcome.people.map((person) => person.actorId)).toEqual(["Beryl"]);

    alpha.socket.send(JSON.stringify({ type: "voicePresence", on: true }));
    alpha.socket.send(JSON.stringify({ type: "voice", to: "Beryl", signal: { kind: "offer", sdp: "v=0" } }));
    await alpha.until((frame) => frame.type === "voicePresence" && frame.actorId === "Beryl");
    await beta.until((frame) => frame.type === "snapshot");
    expect(beta.frames.some((frame) => frame.type === "voice" || frame.type === "voicePresence")).toBe(false);
    for (const frame of beta.frames.filter((frame) => frame.type === "snapshot")) {
      expect(frame.people.map((person) => person.actorId)).toEqual(["Beryl"]);
    }
    const betaPresence = await app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie: b } });
    expect(betaPresence.json().people.map((person: { actorId: string }) => person.actorId)).toEqual(["Beryl"]);
  });

  it("closes a previous room's socket when the same session switches rooms", async () => {
    joinedRooms({ both: ["alpha", "beta"] });
    const { as, enter, origin, hubFor } = await boot();
    const cookie = as("Aster", "both");
    expect((await enter(cookie, "alpha")).statusCode).toBe(200);
    const inAlpha = await connect(origin, cookie);
    await inAlpha.until((frame) => frame.type === "welcome");
    expect(hubFor("alpha").presence.find("Aster")).toBeDefined();

    expect((await enter(cookie, "beta")).statusCode).toBe(200);
    expect(hubFor("alpha").presence.find("Aster")).toBeUndefined();
    const inBeta = await connect(origin, cookie);
    const welcome = await inBeta.until((frame) => frame.type === "welcome");
    if (welcome.type !== "welcome") throw new Error("no welcome");
    expect(welcome.people.map((person) => person.actorId)).toEqual(["Aster"]);
  });

  it("does not evict another session for the same person from its room", async () => {
    joinedRooms({ both: ["alpha", "beta"] });
    const { as, enter, origin, hubFor } = await boot();
    const first = as("Aster", "both");
    const second = as("Aster", "both");
    expect((await enter(first, "alpha")).statusCode).toBe(200);
    expect((await enter(second, "alpha")).statusCode).toBe(200);
    const firstTab = await connect(origin, first);
    const secondTab = await connect(origin, second);
    await firstTab.until((frame) => frame.type === "welcome");
    await secondTab.until((frame) => frame.type === "welcome");
    expect(hubFor("alpha").connectedSockets).toBe(2);

    expect((await enter(first, "beta")).statusCode).toBe(200);
    expect(hubFor("alpha").connectedSockets).toBe(1);
    expect(hubFor("alpha").presence.find("Aster")).toBeDefined();
    expect(secondTab.socket.readyState).toBe(WebSocket.OPEN);
  });

  it("closes room sockets on logout and removes an expired session at the next sweep", async () => {
    joinedRooms({ member: ["alpha"] });
    const { as, enter, origin, hubFor, app, sessions, config } = await boot();
    const first = as("Aster", "member");
    expect((await enter(first, "alpha")).statusCode).toBe(200);
    const live = await connect(origin, first);
    await live.until((frame) => frame.type === "welcome");
    expect((await app.inject({ method: "POST", url: "/bff/logout", headers: { cookie: first } })).statusCode).toBe(200);
    expect(hubFor("alpha").connectedSockets).toBe(0);

    const second = as("Beryl", "member");
    expect((await enter(second, "alpha")).statusCode).toBe(200);
    const waiting = await connect(origin, second);
    await waiting.until((frame) => frame.type === "welcome");
    const sid = second.slice(`${config.cookieName}=`.length);
    sessions.destroy(sid); // expiration has the same observable store state
    expect(hubFor("alpha").evictInvalidSessions((socketSid) => !!sessions.get(socketSid))).toBe(1);
    expect(hubFor("alpha").connectedSockets).toBe(0);
  });

  it("evicts a socket opened between overlapping enter requests for one session", async () => {
    let releaseFirst!: () => void;
    let sawFirst!: () => void;
    const firstIsWaiting = new Promise<void>((resolve) => { sawFirst = resolve; });
    const firstMayFinish = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (++calls === 1) { sawFirst(); await firstMayFinish; }
      return new Response(JSON.stringify({ rooms: [{ roomName: "alpha" }, { roomName: "beta" }] }), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }));
    const { as, enter, origin, hubFor, sessions, config } = await boot();
    const cookie = as("Aster", "both");
    const sid = cookie.slice(`${config.cookieName}=`.length);

    const slowAlpha = enter(cookie, "alpha");
    await firstIsWaiting;
    expect((await enter(cookie, "beta")).statusCode).toBe(200);
    const beta = await connect(origin, cookie);
    await beta.until((frame) => frame.type === "welcome");
    expect(hubFor("beta").connectedSockets).toBe(1);

    releaseFirst();
    expect((await slowAlpha).statusCode).toBe(200);
    expect(sessions.get(sid)?.spaceRoom).toBe("alpha");
    expect(hubFor("beta").connectedSockets).toBe(0);
    const alpha = await connect(origin, cookie);
    const welcome = await alpha.until((frame) => frame.type === "welcome");
    if (welcome.type !== "welcome") throw new Error("no welcome");
    expect(welcome.people.map((person) => person.actorId)).toEqual(["Aster"]);
  });

  it("keeps legacy activity out of another explicitly selected room without ejecting a second default session", async () => {
    joinedRooms({ agent: ["saha.ing", "alpha"] });
    const { sessions, config, enter, activity, space, database, app } = await boot();
    new BoardStore(database).ensureActor("Moraine", "agent");
    const first = `${config.cookieName}=${sessions.create("Moraine", "agent", "agent")}`;
    activity.rehydrate();
    expect(space.presence.find("Moraine")).toBeDefined();

    expect((await enter(first, "alpha")).statusCode).toBe(200);
    expect(space.presence.find("Moraine")).toBeUndefined();
    activity.observeRead("Moraine", "agent", "tasks");
    activity.rehydrate();
    expect(space.presence.find("Moraine")).toBeUndefined();

    // Another device deliberately stays in the development room. Its actor
    // may still be inferred there even when the first device is in alpha.
    const second = `${config.cookieName}=${sessions.create("moraine", "agent", "agent")}`;
    expect((await enter(second, "saha.ing")).statusCode).toBe(200);
    activity.observeRead("Moraine", "agent", "tasks");
    expect(space.presence.find("Moraine")).toBeDefined();
    expect((await app.inject({ method: "POST", url: "/bff/logout", headers: { cookie: second } })).statusCode).toBe(200);
    expect(space.presence.find("Moraine")).toBeUndefined();

    const expiringSid = sessions.create("Moraine", "agent", "agent");
    activity.observeRead("Moraine", "agent", "tasks");
    expect(space.presence.find("Moraine")).toBeDefined();
    sessions.destroy(expiringSid);
    activity.step();
    expect(space.presence.find("Moraine")).toBeUndefined();
  });

  it("does not disclose another room's words or screens, including audio and a share-link upload", async () => {
    joinedRooms({ alpha: ["alpha", "beta"], beta: ["beta"] });
    const { as, enter, app } = await boot();
    const a = as("Aster", "alpha");
    const b = as("Beryl", "beta");
    expect((await enter(a, "alpha")).statusCode).toBe(200);
    expect((await enter(b, "beta")).statusCode).toBe(200);

    const said = await app.inject({ method: "POST", url: "/bff/space/utterances", headers: { cookie: a },
      payload: { source: "text", say: "Alpha only" } });
    expect(said.statusCode).toBe(200);
    const id = said.json().utterance.id as number;
    const words = await app.inject({ method: "GET", url: "/bff/space/utterances", headers: { cookie: b } });
    expect(words.json().utterances).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/bff/space/utterances/${id}/audio`,
      headers: { cookie: b } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/bff/space/attending", headers: { cookie: b },
      payload: { utteranceId: id } })).statusCode).toBe(404);

    const share = await app.inject({ method: "POST", url: "/bff/space/screens/key", headers: { cookie: a }, payload: {} });
    expect(share.statusCode).toBe(200);
    const image = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
    expect((await app.inject({ method: "PUT", url: "/bff/space/screens/frame",
      headers: { "x-screen-key": share.json().key, "content-type": "image/webp" }, payload: image })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: b } })).json().screens).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/bff/space/screens/Aster/frame",
      headers: { cookie: b } })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: a } })).json().screens)
      .toHaveLength(1);

    // The key keeps its minting room when its owner changes their session's
    // selected room; the unsigned share page has no cookie to consult.
    expect((await enter(a, "beta")).statusCode).toBe(200);
    expect((await app.inject({ method: "PUT", url: "/bff/space/screens/frame",
      headers: { "x-screen-key": share.json().key, "content-type": "image/webp" }, payload: image })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/bff/space/screens", headers: { cookie: a } })).json().screens).toEqual([]);
  });

  it("backfills pre-lobby screen links to saha.ing without revoking them", () => {
    const db = new DatabaseSync(":memory:");
    for (const migration of MIGRATIONS.filter((entry) => entry.id <= 29)) db.exec(migration.sql);
    db.prepare("INSERT INTO screen_share_keys (key_hash, actor_id, actor_key, expires_at, shared_by) VALUES (?,?,?,?,?)")
      .run("old-hash", "Sill", "sill", Date.now() + 60_000, null);
    db.exec(MIGRATIONS.find((entry) => entry.id === 30)!.sql);
    expect(db.prepare("SELECT actor_id, room FROM screen_share_keys WHERE key_hash = 'old-hash'").get())
      .toEqual({ actor_id: "Sill", room: "saha.ing" });
    db.close();
  });
});
