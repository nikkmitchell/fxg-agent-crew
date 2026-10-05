import { DatabaseSync } from "node:sqlite";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleRoomItem } from "../../shared/room-items.js";
import { openDatabase } from "../db/open.js";
import { FinishedSpaces, registerFinishedRoutes } from "../space/finished.js";
import { RoomItems, registerRoomItemRoutes } from "../space/items.js";
import { MemorySessionStore } from "../session.js";
import { testConfig } from "./test-config.js";

/** A finished space: one experience, its own public room, pinned and locked (Nikk, 6940). */
function boot() {
  const config = testConfig();
  const sessions = new MemorySessionStore(60_000);
  const database = openDatabase(":memory:", DatabaseSync);
  const items = new RoomItems(database);
  const finished = new FinishedSpaces(database);
  const rooms: Array<{ roomName: string; visibility: string }> = [];
  let live = "d1";
  const app = Fastify();
  app.register(cookie);
  // Branch "empty" lists nothing; branch "gone" has nothing live; "mica-camp" is live at m1.
  const describeModule = async (_who: unknown, source: { branch: string; entry: string }) =>
    source.branch === "empty" ? { status: 404, error: "no such thing" }
      : source.entry === "camp" ? { name: "Desert camp", role: "space" as const } : source.entry === "drums" ? { name: "Hand drums", role: "item" as const } : { status: 404, error: "no such thing" };
  registerRoomItemRoutes(app, { config, sessions, items, announce: () => undefined, describeModule, locked: (room) => finished.has(room) });
  registerFinishedRoutes(app, {
    config, sessions, finished, items, describeModule,
    client: { request: async (_path: string, options?: { body?: unknown }) => {
      const body = options?.body as { roomName: string; visibility: string };
      const exists = rooms.some((room) => room.roomName === body.roomName);
      if (!exists) rooms.push(body);
      return { roomName: body.roomName, created: !exists } as never;
    } },
    liveDeploy: (_space: string, branch: string) => (branch === "mica-camp" ? "m1" : branch === "gone" ? null : live),
    announce: () => undefined,
  });
  const as = (username: string, room = "saha.ing") => {
    const id = sessions.create(username, "t");
    sessions.get(id)!.spaceRoom = room;
    return { [config.cookieName]: id };
  };
  return { app, items, finished, rooms, as, setLive: (id: string) => (live = id) };
}

const camp = { space: "xr.instruments", branch: "sill-camp", entry: "camp" };

describe("finished spaces", () => {
  it("publishes a space as its own public room, at full size, pinned to the live deploy", async () => {
    const { app, items, rooms, as } = boot();
    const answer = await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "Desert Camp", source: camp } });
    expect(answer.statusCode).toBe(201);
    // WebHarness names rooms with letters, digits and _ . - only: the title is what people read.
    expect(rooms).toEqual([{ roomName: "desert-camp", visibility: "public" }]);
    const [thing] = items.all("desert-camp") as ModuleRoomItem[];
    expect(thing).toMatchObject({ view: "full", name: "Desert camp", source: { ...camp, deploy: "d1" } });
    const listed = (await app.inject({ method: "GET", url: "/bff/finished", cookies: as("Baiwei") })).json();
    expect(listed.spaces).toMatchObject([{ room: "desert-camp", title: "Desert Camp", deploy: "d1", by: "Nikk2" }]);
  });

  it("keeps its things as published: nothing is added, moved or taken away inside it", async () => {
    const { app, items, as } = boot();
    await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "Desert Camp", source: camp } });
    const inside = as("Baiwei", "desert-camp");
    const [thing] = items.all("desert-camp");
    expect((await app.inject({ method: "DELETE", url: `/bff/space/items/${thing.id}`, cookies: inside })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/bff/space/items/${thing.id}`, cookies: inside, payload: { scale: 2 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/bff/space/items", cookies: inside, payload: { kind: "go" } })).statusCode).toBe(403);
    expect(items.all("desert-camp")).toHaveLength(1);
  });

  it("updates only when asked: a push does not change it, Update pins the newest", async () => {
    const { app, items, as, setLive } = boot();
    await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "Desert Camp", source: camp } });
    setLive("d2");
    expect((items.all("desert-camp")[0] as ModuleRoomItem).source.deploy).toBe("d1");
    // What the deploy clean-up must leave alone (spaces/deploy.ts): the version it shows.
    expect(items.pinnedDeploys()).toEqual(new Set(["d1"]));
    const updated = await app.inject({ method: "POST", url: "/bff/finished/desert-camp/update", cookies: as("Sill") });
    expect(updated.statusCode).toBe(200);
    expect((items.all("desert-camp")[0] as ModuleRoomItem).source.deploy).toBe("d2");
    expect(items.pinnedDeploys()).toEqual(new Set(["d2"]));
  });

  it("moves to another branch of its space when asked, keeping its room and its title (Meditation, Nikk 6946)", async () => {
    const { app, items, finished, as } = boot();
    await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "Desert Camp", source: camp } });
    const update = (payload?: object) => app.inject({ method: "POST", url: "/bff/finished/desert-camp/update", cookies: as("Sill"), ...(payload ? { payload } : {}) });
    const moved = await update({ branch: "mica-camp" });
    expect(moved.statusCode).toBe(200);
    expect(moved.json().finished).toMatchObject({ room: "desert-camp", title: "Desert Camp", branch: "mica-camp", deploy: "m1" });
    expect((items.all("desert-camp")[0] as ModuleRoomItem).source).toEqual({ ...camp, branch: "mica-camp", deploy: "m1" });
    // A branch without the thing, a branch with nothing live, and a bad name all leave it where it was.
    expect((await update({ branch: "empty" })).statusCode).toBe(404);
    expect((await update({ branch: "gone" })).statusCode).toBe(409);
    expect((await update({ branch: "../main" })).statusCode).toBe(400);
    expect((await update({ branch: 7 })).statusCode).toBe(400);
    expect(finished.get("desert-camp")).toMatchObject({ branch: "mica-camp", deploy: "m1" });
    // From then on a plain Update follows the branch it moved to.
    expect((await update()).json().finished).toMatchObject({ branch: "mica-camp", deploy: "m1" });
    expect(items.all("desert-camp")).toHaveLength(1);
  });

  it("refuses an item (it goes inside a space), a taken title, and a room that already exists", async () => {
    const { app, rooms, as } = boot();
    expect((await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "Drums", source: { ...camp, entry: "drums" } } })).statusCode).toBe(400);
    await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "Desert Camp", source: camp } });
    expect((await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "desert camp", source: camp } })).statusCode).toBe(409);
    rooms.push({ roomName: "lobby-two", visibility: "public" });
    expect((await app.inject({ method: "POST", url: "/bff/finished", cookies: as("Nikk2"), payload: { title: "Lobby Two", source: camp } })).statusCode).toBe(409);
  });
});
