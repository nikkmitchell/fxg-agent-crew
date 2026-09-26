import { afterEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildServer } from "../index.js";
import { openDatabase } from "../db/open.js";
import { BoardStore } from "../db/store.js";
import { tempDir } from "./test-config.js";

/**
 * ONE ROOM, ONE PROJECT. Nikk (chat 4586): "one room should be one project, as
 * well as one webharness.chat chat room". So making a room from the lobby makes
 * its project, shows that project's board in the room from the start, and
 * being in the room is enough to belong to it — for a person who joins
 * through the lobby and for an agent that joined its chat room directly and
 * then enters. Public or private, password or not: Nikk (4643, 4649) wants no
 * blocks, and a password is the one lock a room can choose.
 *
 * Through the whole server, with WebHarness faked: who is in which room is the
 * one thing the real check asks upstream.
 */

const running: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of running.splice(0)) await close();
  vi.unstubAllGlobals();
});

type Upstream = { rooms: Map<string, "public" | "private">; members: Map<string, Set<string>> };

/** A small WebHarness: rooms exist once created, and each token has its joined rooms. */
function fakeWebharness(): Upstream {
  const upstream: Upstream = { rooms: new Map(), members: new Map() };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const token = String((options?.headers as Record<string, string>)?.Authorization ?? "").replace(/^Bearer /, "");
    const path = new URL(url).pathname;
    const joined = upstream.members.get(token) ?? new Set<string>();
    if (path === "/api/rooms" && (options?.method ?? "GET") === "GET") {
      return json(200, { rooms: [...joined].map((roomName) => ({ roomName })) });
    }
    if (path === "/api/rooms" && options?.method === "POST") {
      const { roomName, visibility } = JSON.parse(String(options.body));
      const created = !upstream.rooms.has(roomName);
      if (created) upstream.rooms.set(roomName, visibility ?? "public");
      joined.add(roomName);
      upstream.members.set(token, joined);
      return json(200, { roomName, created });
    }
    const one = path.match(/^\/api\/rooms\/([^/]+)$/);
    if (one) {
      const name = decodeURIComponent(one[1]);
      if (!upstream.rooms.has(name)) return json(404, { detail: "no such room" });
      if (!joined.has(name)) return json(403, { detail: "not a member" });
      return json(200, { roomName: name });
    }
    return json(404, { detail: `unfaked ${path}` });
  }));
  return upstream;
}

async function boot() {
  const upstream = fakeWebharness();
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: tempDir("blobs-"),
    LOG_LEVEL: "silent",
  });
  await built.app.ready();
  running.push(async () => void (await built.app.close()));
  const as = (username: string, token: string, kind: "human" | "agent" = "human") =>
    `${built.config.cookieName}=${built.sessions.create(username, token, kind)}`;
  const call = (cookie: string, method: "GET" | "POST" | "PUT", url: string, payload?: unknown) =>
    built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const members = async (cookie: string, projectId: string) => {
    const read = await call(cookie, "GET", `/bff/board/projects/${projectId}`);
    return (read.json().memberships ?? []).filter((m: { active: number | boolean }) => m.active)
      .map((m: { actorId?: string; actor_id?: string }) => (m.actorId ?? m.actor_id)!.toLowerCase()).sort();
  };
  return { ...built, upstream, as, call, members };
}

describe("one room, one project", () => {
  it("a new private room gets its own project, shown in the room from the start, with its maker as manager", async () => {
    const { as, call, members } = await boot();
    const nikk = as("Nikk2", "nikk");
    const made = await call(nikk, "POST", "/bff/rooms/create", { roomName: "Studio Night", visibility: "private" });
    expect(made.statusCode).toBe(201);

    const project = await call(nikk, "GET", "/bff/board/projects/studio-night");
    expect(project.statusCode).toBe(200);
    expect(project.json().project.name).toBe("Studio Night");
    expect(await members(nikk, "studio-night")).toEqual(["nikk2"]);

    expect((await call(nikk, "POST", "/bff/space/enter", { roomName: "Studio Night" })).statusCode).toBe(200);
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).toBe("studio-night");
  });

  it("switching rooms switches boards, and each room keeps its own", async () => {
    const { as, call, upstream } = await boot();
    upstream.members.set("nikk", new Set(["saha.ing"]));
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "garden", visibility: "private" });

    await call(nikk, "POST", "/bff/space/enter", { roomName: "garden" });
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).toBe("garden");
    await call(nikk, "POST", "/bff/space/enter", { roomName: "saha.ing" });
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).not.toBe("garden");
    await call(nikk, "POST", "/bff/space/enter", { roomName: "garden" });
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).toBe("garden");
  });

  it("an agent that joined the chat room itself belongs to the project once it enters", async () => {
    const { as, call, members, upstream } = await boot();
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "garden", visibility: "private" });
    // The agent joins the WebHarness room directly, as agents do, not through the lobby.
    upstream.members.set("vint", new Set(["garden"]));
    const vint = as("Vint", "vint", "agent");
    expect((await call(vint, "POST", "/bff/space/enter", { roomName: "garden" })).statusCode).toBe(200);
    expect(await members(nikk, "garden")).toEqual(["nikk2", "vint"]);
    // And entering twice changes nothing.
    await call(vint, "POST", "/bff/space/enter", { roomName: "garden" });
    expect(await members(nikk, "garden")).toEqual(["nikk2", "vint"]);
  });

  it("a person who joins through the lobby belongs too", async () => {
    const { as, call, members } = await boot();
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "garden", visibility: "private" });
    const baiwei = as("baiwei2", "baiwei");
    expect((await call(baiwei, "POST", "/bff/rooms/garden/join", {})).statusCode).toBe(200);
    expect(await members(nikk, "garden")).toEqual(["baiwei2", "nikk2"]);
  });

  it("a PUBLIC room works the same: whoever joins it is on its board", async () => {
    const { as, call, members } = await boot();
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "open house", visibility: "public" });
    const lumenfold = as("Lumenfold", "lumenfold", "agent");
    expect((await call(lumenfold, "POST", "/bff/rooms/open%20house/join", {})).statusCode).toBe(200);
    expect(await members(nikk, "open-house")).toEqual(["lumenfold", "nikk2"]);
  });

  it("a room made straight on webharness.chat gets its board the first time somebody enters it", async () => {
    // Nikk made meditation.AR on webharness.chat, not in the lobby: it had no
    // project and no agent could give it one (Nightjar, 4650).
    const { as, call, members, upstream } = await boot();
    upstream.rooms.set("meditation.AR", "public");
    upstream.members.set("nightjar", new Set(["meditation.AR"]));
    upstream.members.set("sill", new Set(["meditation.AR"]));
    const nightjar = as("Nightjar", "nightjar", "agent");
    expect((await call(nightjar, "POST", "/bff/space/enter", { roomName: "meditation.AR" })).statusCode).toBe(200);
    expect((await call(nightjar, "GET", "/bff/space/showing")).json().showing.projectId).toBe("meditation-ar");
    // The next one in belongs too, and does not make a second project.
    const sill = as("Sill", "sill", "agent");
    await call(sill, "POST", "/bff/space/enter", { roomName: "meditation.AR" });
    expect((await call(sill, "GET", "/bff/space/showing")).json().showing.projectId).toBe("meditation-ar");
    expect(await members(nightjar, "meditation-ar")).toEqual(["nightjar", "sill"]);
    expect((await call(sill, "GET", "/bff/board/projects/meditation-ar-2")).statusCode).toBe(404);
  });

  it("links a hand-picked board only for its MANAGER, never for a mere member", async () => {
    const { as, call, members, upstream } = await boot();
    upstream.rooms.set("studio", "private");
    upstream.members.set("nikk", new Set(["studio"]));
    upstream.members.set("guest", new Set(["studio"]));
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/space/enter", { roomName: "studio" }); // makes and links "studio"
    await call(nikk, "POST", "/bff/board/projects", { id: "secret", name: "Somebody else's" });
    await call(nikk, "PUT", "/bff/space/showing", { projectId: "secret" });
    const guest = as("Guest", "guest");
    await call(guest, "POST", "/bff/space/enter", { roomName: "studio" });
    // The room was already linked to "studio", so the hand-picked "secret" is not linked, and guest is not on it.
    expect(await members(nikk, "secret")).toEqual(["nikk2"]);
  });

  it("a room that already shows a board is left exactly as it is", async () => {
    const { as, call, upstream } = await boot();
    upstream.rooms.set("studio", "private");
    upstream.members.set("nikk", new Set(["studio"]));
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/board/projects", { id: "chosen", name: "Chosen by hand" });
    await call(nikk, "POST", "/bff/space/enter", { roomName: "studio" });
    // Entering made it a project, since it had none and showed none...
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).toBe("studio");
    // ...and once a person picks a different board, entering again never overrides it.
    await call(nikk, "PUT", "/bff/space/showing", { projectId: "chosen" });
    await call(nikk, "POST", "/bff/space/enter", { roomName: "studio" });
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).toBe("chosen");
  });

  it("a room named like an existing project gets its own project, never someone else's", async () => {
    const { as, call, members } = await boot();
    const other = as("Other", "other");
    await call(other, "POST", "/bff/board/projects", { id: "garden", name: "Somebody's garden" });
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "garden", visibility: "private" });
    await call(nikk, "POST", "/bff/space/enter", { roomName: "garden" });
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).toBe("garden-2");
    expect(await members(other, "garden")).toEqual(["other"]);
  });
});

describe("linking a board somebody put up by hand", () => {
  // What join-room.mts (130f4b8) does on a box without the entry fix: makes the
  // room's project and puts it on the wall, but links nothing, so nobody who
  // joins afterwards is on the board. Its manager entering the room links it.
  const setup = () => {
    const db = openDatabase(":memory:", DatabaseSync);
    const store = new BoardStore(db);
    const nightjar = { id: "Nightjar", kind: "agent" as const };
    store.createProject(nightjar, { id: "meditation-ar", name: "meditation.AR" });
    return { store, nightjar };
  };

  it("links it for the project's manager, and then the next person in belongs", () => {
    const { store, nightjar } = setup();
    expect(store.linkRoomByManager(nightjar, "meditation-ar", "meditation.AR")).toBe(true);
    expect(store.roomProject("meditation.AR")).toBe("meditation-ar");
    expect(store.enrolFromRoom("Sill", "meditation.AR", "agent")).toEqual(["meditation-ar"]);
  });

  it("refuses anyone who is not its manager", () => {
    const { store } = setup();
    expect(store.linkRoomByManager({ id: "Stranger", kind: "human" }, "meditation-ar", "meditation.AR")).toBe(false);
    expect(store.roomProject("meditation.AR")).toBeNull();
  });

  it("never re-links a room that has one, or ties one project to two rooms", () => {
    const { store, nightjar } = setup();
    store.linkRoomByManager(nightjar, "meditation-ar", "meditation.AR");
    store.createProject(nightjar, { id: "other", name: "Other" });
    expect(store.linkRoomByManager(nightjar, "other", "meditation.AR")).toBe(false);
    expect(store.linkRoomByManager(nightjar, "meditation-ar", "another.room")).toBe(false);
  });
});
