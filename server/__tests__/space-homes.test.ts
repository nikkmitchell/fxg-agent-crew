import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildServer } from "../index.js";
import { openDatabase } from "../db/open.js";
import { Presence } from "../space/presence.js";
import { Activity, ATTENTION_MS } from "../space/activity.js";
import { AgentHomes } from "../space/homes.js";
import { BoardStore } from "../db/store.js";
import { ROOM, deskFor } from "../../shared/space-layout.js";

/**
 * Nikk: "agents should choose a position where they stay and they should
 * remember that... allow users to be able to tell them like 'I want you to be
 * standing over here facing me'... and then they should set that to their home
 * space".
 */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  const as = (username: string, kind: "human" | "agent" = "human") =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", kind)}`;
  const seed = (id: string, kind: "human" | "agent") =>
    built.database.prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
      .run(id, kind, "2026-09-14T00:00:00Z", "2026-09-14T00:00:00Z");
  return { ...built, as, seed };
};

const place = (app: Awaited<ReturnType<typeof boot>>["app"], cookie: string, actorId: string, body: unknown) =>
  app.inject({ method: "PUT", url: `/bff/space/homes/${actorId}`, headers: { cookie }, payload: body as object });

describe("placing an agent's home", () => {
  it("lets a person put an agent somewhere, facing a chosen way, and walks it there now", async () => {
    const { app, as, seed, space } = boot();
    seed("Sill", "agent");
    const response = await place(app, as("Nikk2"), "Sill", { x: 2, z: 3, facing: 1.2 });
    expect(response.statusCode).toBe(200);
    const sill = space.presence.find("Sill")!;
    expect(sill.heading.x).toBeCloseTo(2, 1);
    expect(sill.heading.z).toBeCloseTo(3, 1);
    expect(sill.because, "home needs no explanation, and a label hides its screen").toBeNull();
    const list = await app.inject({ method: "GET", url: "/bff/space/homes", headers: { cookie: as("Nikk2") } });
    expect(list.json().homes).toEqual([expect.objectContaining({ actorId: "Sill", facing: expect.closeTo(1.2, 9), setBy: "Nikk2" })]);
    await app.close();
  });

  it("keeps a home inside the room", async () => {
    const { app, as, seed } = boot();
    seed("Sill", "agent");
    const response = await place(app, as("Nikk2"), "Sill", { x: 500, z: -500, facing: 0 });
    expect(Math.abs(response.json().home.at.x)).toBeLessThan(ROOM.width / 2);
    expect(Math.abs(response.json().home.at.z)).toBeLessThan(ROOM.depth / 2);
    await app.close();
  });

  it("never places a person — they stand where their own headset says", async () => {
    const { app, as, seed } = boot();
    seed("baiwei2", "human");
    expect((await place(app, as("Nikk2"), "baiwei2", { x: 1, z: 1, facing: 0 })).statusCode).toBe(403);
    await app.close();
  });

  it("lets an agent choose its own home, but not another agent's", async () => {
    const { app, as, seed } = boot();
    seed("Sill", "agent");
    seed("Inkstone", "agent");
    expect((await place(app, as("Sill", "agent"), "Sill", { x: 1, z: 1, facing: 0 })).statusCode).toBe(200);
    expect((await place(app, as("Sill", "agent"), "Inkstone", { x: 1, z: 1, facing: 0 })).statusCode).toBe(403);
    await app.close();
  });

  it("refuses a home that is not three numbers, and anyone not signed in", async () => {
    const { app, as, seed } = boot();
    seed("Sill", "agent");
    expect((await place(app, as("Nikk2"), "Sill", { x: "left", z: 1, facing: 0 })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/bff/space/homes/Sill", payload: { x: 1, z: 1, facing: 0 } })).statusCode).toBe(401);
    await app.close();
  });

  it("puts an agent back at its desk when its home is cleared", async () => {
    const { app, as, seed, space } = boot();
    seed("Sill", "agent");
    await place(app, as("Nikk2"), "Sill", { x: 2, z: 3, facing: 0 });
    const cleared = await app.inject({ method: "DELETE", url: "/bff/space/homes/Sill", headers: { cookie: as("Nikk2") } });
    expect(cleared.statusCode).toBe(200);
    const desk = deskFor("Sill");
    const sill = space.presence.find("Sill")!;
    expect(Math.hypot(sill.heading.x - desk.x, sill.heading.z - desk.z)).toBeLessThan(1);
    await app.close();
  });
});

describe("a home is remembered", () => {
  const room = () => {
    const database = openDatabase(":memory:", DatabaseSync);
    return { database, homes: new AgentHomes(database) };
  };

  it("across a restart: the agent arrives at its home, facing the way it was placed", () => {
    const { homes } = room();
    homes.set("Sill", { at: { x: -2, y: 0, z: 1 }, facing: 2 }, "Nikk2");
    const presence = new Presence(Date.now, null, homes);
    const sill = presence.join("Sill", "agent", true);
    expect(sill.at).toEqual({ x: -2, y: 0, z: 1 });
    expect(sill.facing).toBeCloseTo(2, 9);
  });

  it("and is where it walks back to after working at a board", () => {
    const { database, homes } = room();
    homes.set("Plumbline", { at: { x: 3, y: 0, z: 2 }, facing: -1 }, "Nikk2");
    let clock = 1_000_000;
    const presence = new Presence(() => clock, null, homes);
    const activity = new Activity(database, presence, () => clock, () => ({}), (id) => homes.get(id));
    activity.catchUp();
    const store = new BoardStore(database);
    const nikk = { id: "nikk", kind: "human" as const };
    const projectId = store.createProject(nikk, { name: "p" });
    store.actOnMembership(nikk, projectId, "Plumbline", "grant", ["maker"]);
    store.createTask({ id: "Plumbline", kind: "agent" }, { projectId, title: "a card" });
    activity.step();
    clock += ATTENTION_MS + 1;
    activity.step();
    const plumbline = presence.find("Plumbline")!;
    expect(plumbline.heading).toEqual({ x: 3, y: 0, z: 2 });
    expect(plumbline.because).toBeNull();
  });

  it("treats two spellings of one agent as one home", () => {
    const { homes } = room();
    homes.set("Inkstone", { at: { x: 1, y: 0, z: 1 }, facing: 0 }, "Nikk2");
    expect(homes.get("inkstone")).not.toBeNull();
  });
});
