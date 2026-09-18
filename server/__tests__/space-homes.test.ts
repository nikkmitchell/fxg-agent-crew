import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildServer } from "../index.js";
import { openDatabase } from "../db/open.js";
import { Presence } from "../space/presence.js";
import { Activity, ATTENTION_MS } from "../space/activity.js";
import { AgentHomes } from "../space/homes.js";
import { BoardStore } from "../db/store.js";
import { ROOM, WORLD, deskFor } from "../../shared/space-layout.js";

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

  it("lets a home sit far outside the old walls, so an agent can follow you out", async () => {
    // The walking rail is gone at Nikk's request, and a home clamped to the
    // room would have quietly broken the main thing homes are for: somebody
    // standing well outside asking an agent to come and stand with them.
    const { app, as, seed } = boot();
    seed("Sill", "agent");
    const response = await place(app, as("Nikk2"), "Sill", { x: 500, z: -500, facing: 0 });
    expect(response.json().home.at.x).toBe(500);
    expect(response.json().home.at.z).toBe(-500);
    expect(Math.abs(response.json().home.at.x)).toBeGreaterThan(ROOM.width / 2);
    await app.close();
  });

  it("keeps a home finite when the numbers are absurd", async () => {
    const { app, as, seed } = boot();
    seed("Sill", "agent");
    const response = await place(app, as("Nikk2"), "Sill", { x: 1e12, z: -1e12, facing: 0 });
    const at = response.json().home.at;
    expect(Math.abs(at.x)).toBeLessThanOrEqual(WORLD.half);
    expect(Math.abs(at.z)).toBeLessThanOrEqual(WORLD.half);
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

  it("refuses a home without a real spot or any facing, and anyone not signed in", async () => {
    const { app, as, seed } = boot();
    seed("Sill", "agent");
    expect((await place(app, as("Nikk2"), "Sill", { x: "left", z: 1, facing: 0 })).statusCode).toBe(400);
    // A spot with no way to face it: neither an angle nor a name to look at.
    expect((await place(app, as("Nikk2"), "Sill", { x: 1, z: 1 })).statusCode).toBe(400);
    expect((await app.inject({ method: "PUT", url: "/bff/space/homes/Sill", payload: { x: 1, z: 1, facing: 0 } })).statusCode).toBe(401);
    await app.close();
  });

  /**
   * clem, to Waffle, after watching it happen in a headset: "when I tell you to
   * go to someone, you do the right thing within the face the wrong direction.
   * You have to rotate by 180 degrees."
   *
   * An agent outside the room cannot check its own arithmetic against anything.
   * So it may now name the person instead, and the server — which knows where
   * everybody is standing and holds the only copy of the sign convention —
   * works out the angle.
   */
  it("faces a named person, computed from where the agent will stand", async () => {
    const { app, as, seed, space } = boot();
    seed("Waffle", "agent");
    space.presence.join("clem", "human", true);
    space.presence.moveSelf("clem", { x: -2, y: 0, z: 2 }, 0);

    const response = await place(app, as("Waffle", "agent"), "Waffle", { x: 1, z: 1, face: "clem" });
    expect(response.statusCode).toBe(200);

    // The assertion a person in the room can make: Waffle's forward vector
    // points AT clem. Backwards, this dot product is -1.
    const home = response.json().home;
    const forward = { x: -Math.sin(home.facing), z: -Math.cos(home.facing) };
    const toClem = { x: -2 - home.at.x, z: 2 - home.at.z };
    const length = Math.hypot(toClem.x, toClem.z);
    expect((forward.x * toClem.x + forward.z * toClem.z) / length).toBeCloseTo(1, 6);
    await app.close();
  });

  it("matches two spellings of a name, so 'nikk2' finds Nikk2", async () => {
    const { app, as, seed, space } = boot();
    seed("Waffle", "agent");
    space.presence.join("Nikk2", "human", true);
    space.presence.moveSelf("Nikk2", { x: 3, y: 0, z: -1 }, 0);
    const response = await place(app, as("Waffle", "agent"), "Waffle", { x: 0, z: 0, face: "nikk2" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("refuses a name nobody in the room answers to, and says who is there", async () => {
    const { app, as, seed, space } = boot();
    seed("Waffle", "agent");
    space.presence.join("clem", "human", true);
    const response = await place(app, as("Waffle", "agent"), "Waffle", { x: 1, z: 1, face: "Clementine" });
    expect(response.statusCode).toBe(400);
    // Named, so the agent can correct itself rather than guess again.
    expect(response.json().error).toContain("clem");
    await app.close();
  });

  /**
   * Found by tools/onboarding-audit.mts on the live site: placing yourself
   * facing your OWN name answered 200 with an angle pointing back at the spot
   * you were leaving. shared/agent-home.test.ts proves resolveFacing refuses
   * it; this proves the ROUTE passes it who is being placed, which is the half
   * anybody actually calls.
   */
  it("refuses to face the agent being placed, however the name is spelled", async () => {
    const { app, as, seed, space } = boot();
    seed("Waffle", "agent");
    space.presence.join("Waffle", "agent", true);
    space.presence.join("clem", "human", true);
    expect(space.presence.find("Waffle")?.at, "Waffle must be standing somewhere for this to mean anything").toBeTruthy();

    for (const face of ["Waffle", "waffle", " WAFFLE "]) {
      const response = await place(app, as("Waffle", "agent"), "Waffle", { x: 1.4, z: 5.2, face });
      expect(response.statusCode, face).toBe(400);
      expect(response.json().code).toBe("BAD_HOME");
    }
    // A person placing the agent asks the same meaningless question.
    expect((await place(app, as("Nikk2"), "Waffle", { x: 1.4, z: 5.2, face: "Waffle" })).statusCode).toBe(400);
    // And naming somebody else still works from the same spot.
    expect((await place(app, as("Waffle", "agent"), "Waffle", { x: 1.4, z: 5.2, face: "clem" })).statusCode).toBe(200);
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

  /**
   * A placement ends a follow or a route (Nightjar, 63a8f24). The person who
   * placed the agent is TOLD, in the reply, rather than left to notice that
   * the agent has stopped walking with somebody. Silence here would be the
   * same shape as the bug the placement fix removed.
   */
  it("tells whoever placed an agent which follow or route that ended", async () => {
    const { app, as, seed, space } = boot();
    seed("Ash", "agent");
    seed("Birch", "agent");
    space.presence.join("Ash", "agent", false);
    space.presence.join("Birch", "agent", false);

    space.presence.follow("Ash", "agent", "Birch", "left", null);
    const placed = await place(app, as("Nikk2"), "Ash", { x: -8, z: -8, facing: 0 });
    expect(placed.json()).toMatchObject({ ok: true, stoppedFollowing: "Birch", abandonedRoute: 0 });
    expect(space.presence.find("Ash")!.following).toBeNull();

    space.presence.walk("Ash", "agent", [{ x: 6, y: 0, z: 2 }, { x: 6, y: 0, z: -6 }], "a tour");
    const cleared = await app.inject({ method: "DELETE", url: "/bff/space/homes/Ash", headers: { cookie: as("Nikk2") } });
    expect(cleared.json()).toMatchObject({ ok: true, stoppedFollowing: null, abandonedRoute: 2 });
    await app.close();
  });

  it("says nothing ended when the agent was doing nothing", async () => {
    const { app, as, seed } = boot();
    seed("Ash", "agent");
    const placed = await place(app, as("Nikk2"), "Ash", { x: 1, z: 1, facing: 0 });
    expect(placed.json()).toMatchObject({ ok: true, stoppedFollowing: null, abandonedRoute: 0 });
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
