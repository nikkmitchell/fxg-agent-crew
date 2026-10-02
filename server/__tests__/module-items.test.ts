import { DatabaseSync } from "node:sqlite";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import type { ModuleRoomItem, RoomItem } from "../../shared/room-items.js";
import { openDatabase } from "../db/open.js";
import { Holds } from "../space/holds.js";
import { RoomItems, registerRoomItemRoutes } from "../space/items.js";
import { ModuleStates } from "../space/module-state.js";
import { MemorySessionStore } from "../session.js";
import { testConfig } from "./test-config.js";

/**
 * THINGS FROM SPACES IN A ROOM (Nikk, 2026-10-01): items stand where they are
 * put and move like the Go table; an environment or a space at full size takes
 * the room's place, one at a time.
 */
const MANIFEST: Record<string, { name: string; role: "item" | "environment" | "space" }> = {
  drums: { name: "Hand drums", role: "item" },
  forest: { name: "Forest", role: "environment" },
  nightclub: { name: "Nightclub", role: "environment" },
  grove: { name: "Grove concert", role: "space" },
};

function boot() {
  const config = testConfig();
  const sessions = new MemorySessionStore(60_000);
  const items = new RoomItems(openDatabase(":memory:", DatabaseSync));
  const holds = new Holds();
  const moduleStates = new ModuleStates();
  const announced: RoomItem[][] = [];
  const app = Fastify();
  app.register(cookie);
  registerRoomItemRoutes(app, {
    config, sessions, items, holds, moduleStates,
    announce: (_room, list) => announced.push(list),
    describeModule: async (who, source) => {
      if (who.username === "stranger") return { status: 403, error: "not yours" };
      const entry = MANIFEST[source.entry];
      return entry ?? { status: 404, error: "no such thing" };
    },
  });
  const as = (username: string) => ({ [config.cookieName]: sessions.create(username, "t") });
  const bring = (username: string, entry: string, extra: Record<string, unknown> = {}) =>
    app.inject({ method: "POST", url: "/bff/space/items", cookies: as(username), payload: { kind: "module", source: { space: "xr.instruments", branch: "main", entry }, ...extra } });
  return { app, items, holds, moduleStates, announced, as, bring };
}

describe("bringing things from a space into a room", () => {
  it("puts an item where it is asked, at its own size, and tells the room", async () => {
    const { bring, items, announced } = boot();
    const answer = await bring("Nikk2", "drums", { position: { x: 1, y: 0, z: 2, rotationY: 0.5 } });
    expect(answer.statusCode).toBe(201);
    const item = answer.json().item as ModuleRoomItem;
    expect(item).toMatchObject({ kind: "module", name: "Hand drums", role: "item", view: "placed", scale: 1, addedBy: "Nikk2", source: { space: "xr.instruments", branch: "main", entry: "drums" } });
    expect(item.position).toEqual({ x: 1, y: 0, z: 2, rotationY: 0.5 });
    expect(items.all("saha.ing")).toEqual([item]);
    expect(announced.at(-1)).toEqual([item]);
  });

  it("opens a space as a small model unless asked full size", async () => {
    const { bring } = boot();
    const model = (await bring("Nikk2", "grove")).json().item as ModuleRoomItem;
    expect(model).toMatchObject({ view: "placed", scale: 0.05 });
    const full = (await bring("Nikk2", "grove", { view: "full" })).json().item as ModuleRoomItem;
    expect(full).toMatchObject({ view: "full", scale: 1, position: { x: 0, y: 0, z: 0, rotationY: 0 } });
  });

  it("lets a room have one surrounding at a time: a new environment replaces the last", async () => {
    const { bring, items } = boot();
    await bring("Nikk2", "drums");
    await bring("Nikk2", "forest");
    await bring("Nikk2", "nightclub");
    expect(items.all("saha.ing").map((item) => (item.kind === "module" ? `${item.source.entry}:${item.view}` : item.kind))).toEqual(["drums:placed", "nightclub:full"]);
  });

  it("refuses what the manifest does not have, what the person may not use, and a malformed source", async () => {
    const { bring, app, as } = boot();
    expect((await bring("Nikk2", "ghost")).statusCode).toBe(404);
    expect((await bring("stranger", "drums")).statusCode).toBe(403);
    const bad = await app.inject({ method: "POST", url: "/bff/space/items", cookies: as("Nikk2"), payload: { kind: "module", source: { space: "../etc", branch: "main", entry: "drums" } } });
    expect(bad.statusCode).toBe(400);
  });

  it("moves and resizes a placed thing, but not one somebody else is holding", async () => {
    const { bring, app, as, holds } = boot();
    const item = (await bring("Nikk2", "drums")).json().item as ModuleRoomItem;
    const move = (who: string, body: Record<string, unknown>) => app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, cookies: as(who), payload: body });
    const moved = await move("Nikk2", { position: { x: -2, y: 0.5, z: 3, rotationY: 1 }, scale: 0.5, revision: 0 });
    expect(moved.json().item).toMatchObject({ position: { x: -2, y: 0.5, z: 3, rotationY: 1 }, scale: 0.5, revision: 1 });
    expect((await move("Nikk2", { scale: 9 })).statusCode).toBe(400);
    expect((await move("Nikk2", { position: { x: 0, y: 0, z: 0, rotationY: 0 }, revision: 0 })).statusCode).toBe(409);
    holds.take("saha.ing", `item:${item.id}`, "baiwei2");
    expect((await move("Nikk2", { position: { x: 0, y: 0, z: 0, rotationY: 0 } })).json()).toMatchObject({ code: "HELD", heldBy: "baiwei2" });
  });

  it("turns a space between a model and full size, and nothing else", async () => {
    const { bring, app, as, items } = boot();
    const env = (await bring("Nikk2", "forest")).json().item as ModuleRoomItem;
    const space = (await bring("Nikk2", "grove")).json().item as ModuleRoomItem;
    const drums = (await bring("Nikk2", "drums")).json().item as ModuleRoomItem;
    const view = (id: string, body: Record<string, unknown>) => app.inject({ method: "PATCH", url: `/bff/space/items/${id}`, cookies: as("Nikk2"), payload: body });
    expect((await view(drums.id, { view: "full" })).statusCode).toBe(400);
    const full = await view(space.id, { view: "full" });
    expect(full.json().item).toMatchObject({ view: "full", scale: 1 });
    // The forest made way for the space at full size.
    expect(items.all("saha.ing").some((item) => item.id === env.id)).toBe(false);
    expect((await view(space.id, { view: "placed" })).json().item).toMatchObject({ view: "placed", scale: 0.05 });
  });

  it("takes moves only at a Go table", async () => {
    const { bring, app, as } = boot();
    const item = (await bring("Nikk2", "drums")).json().item as ModuleRoomItem;
    const action = await app.inject({ method: "POST", url: `/bff/space/items/${item.id}/action`, cookies: as("Nikk2"), payload: { action: "pass" } });
    expect(action.statusCode).toBe(400);
  });

  it("keeps what a thing decided for copies that start later, and forgets it with the thing", async () => {
    const { bring, app, as, moduleStates } = boot();
    const item = (await bring("Nikk2", "drums")).json().item as ModuleRoomItem;
    moduleStates.set("saha.ing", item.id, "tempo", 90);
    const state = await app.inject({ method: "GET", url: `/bff/space/items/${item.id}/state`, cookies: as("baiwei2") });
    expect(state.json()).toEqual({ state: { tempo: 90 } });
    await app.inject({ method: "DELETE", url: `/bff/space/items/${item.id}`, cookies: as("Nikk2") });
    expect(moduleStates.get("saha.ing", item.id)).toEqual({});
  });
});

describe("what things from spaces keep", () => {
  it("is bounded per item, and removing a value frees its room", () => {
    const states = new ModuleStates();
    for (let i = 0; i < 200; i += 1) expect(states.set("saha.ing", "a", `k${i}`, i)).toBe(true);
    expect(states.set("saha.ing", "a", "one-more", 1)).toBe(false);
    expect(states.set("saha.ing", "a", "k0", null)).toBe(true);
    expect(states.set("saha.ing", "a", "one-more", 1)).toBe(true);
    expect(states.set("saha.ing", "b", "big", "x".repeat(300 * 1024))).toBe(false);
    expect(states.get("lobby", "a")).toEqual({});
  });
});
