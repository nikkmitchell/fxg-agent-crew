import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";

/**
 * ONE ROOM, ONE PROJECT. Nikk (chat 4586): "one room should be one project, as
 * well as one webharness.chat chat room". So making a room from the lobby makes
 * its project, shows that project's board in the room from the start, and
 * being in the room is enough to belong to it when the room is LOCKED with a
 * password — for a person who joins through the lobby and for an agent that
 * joined its chat room directly and then enters. "Private" alone is not
 * enough: on WebHarness it means unlisted, and anyone with the name can join.
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
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
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

  it("an agent that joined a LOCKED room's chat itself belongs to the project once it enters", async () => {
    const { as, call, members, upstream } = await boot();
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "garden", visibility: "private", password: "p" });
    // The agent joins the WebHarness room directly, as agents do, not through the lobby.
    upstream.members.set("vint", new Set(["garden"]));
    const vint = as("Vint", "vint", "agent");
    expect((await call(vint, "POST", "/bff/space/enter", { roomName: "garden" })).statusCode).toBe(200);
    expect(await members(nikk, "garden")).toEqual(["nikk2", "vint"]);
    // And entering twice changes nothing.
    await call(vint, "POST", "/bff/space/enter", { roomName: "garden" });
    expect(await members(nikk, "garden")).toEqual(["nikk2", "vint"]);
  });

  it("a person who joins a locked room through the lobby belongs too", async () => {
    const { as, call, members } = await boot();
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "garden", visibility: "private", password: "p" });
    const baiwei = as("baiwei2", "baiwei");
    expect((await call(baiwei, "POST", "/bff/rooms/garden/join", { password: "p" })).statusCode).toBe(200);
    expect(await members(nikk, "garden")).toEqual(["baiwei2", "nikk2"]);
  });

  it("an UNLOCKED private room's project is made, but guessing its name does not hand anyone the board", async () => {
    // Sill joined Nightjar's private room with nothing but its name: private is unlisted, not locked.
    const { as, call, members, upstream } = await boot();
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "studio night", visibility: "private" });
    upstream.members.set("guesser", new Set(["studio night"]));
    const guesser = as("Guesser", "guesser");
    expect((await call(guesser, "POST", "/bff/space/enter", { roomName: "studio night" })).statusCode).toBe(200);
    expect(await members(nikk, "studio-night")).toEqual(["nikk2"]);
    // Its maker still has it, and the room still shows it.
    await call(nikk, "POST", "/bff/space/enter", { roomName: "studio night" });
    expect((await call(nikk, "GET", "/bff/space/showing")).json().showing.projectId).toBe("studio-night");
  });

  it("a PUBLIC room's project is made, but joining it does not hand a stranger the board", async () => {
    const { as, call, members } = await boot();
    const nikk = as("Nikk2", "nikk");
    await call(nikk, "POST", "/bff/rooms/create", { roomName: "open house", visibility: "public" });
    const stranger = as("Stranger", "stranger");
    expect((await call(stranger, "POST", "/bff/rooms/open%20house/join", {})).statusCode).toBe(200);
    expect((await call(stranger, "POST", "/bff/space/enter", { roomName: "open house" })).statusCode).toBe(200);
    expect(await members(nikk, "open-house")).toEqual(["nikk2"]);
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
