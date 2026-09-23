import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { BoardStore } from "../db/store.js";

/**
 * What the room is showing.
 *
 * The thing worth testing here is not the storage — it is that this is SHARED.
 * Every other "which project" in the app is per-browser and changing it is a
 * private act. The room is the opposite, and the difference is the whole
 * feature: two people standing at the same wall pointing at "that card" must be
 * looking at the same card.
 */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: testBlobRoot(),
    LOG_LEVEL: "silent",
  });
  const as = (username: string) =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", "human")}`;
  const store = new BoardStore(built.database);
  return { ...built, as, store };
};

const showingOf = async (app: ReturnType<typeof boot>["app"], cookie: string) => {
  const response = await app.inject({ method: "GET", url: "/bff/space/showing", headers: { cookie } });
  return { status: response.statusCode, ...JSON.parse(response.body) };
};

describe("what the room is showing", () => {
  it("says nothing has been chosen rather than picking a project", async () => {
    // A room that guesses is a room that lies about what it was told.
    const { app, as } = boot();
    const body = await showingOf(app, as("nikk"));
    expect(body.showing).toEqual({ projectId: null, boardId: null, setBy: null, setAt: null });
    await app.close();
  });

  it("refuses to tell somebody who is not signed in", async () => {
    const { app } = boot();
    const response = await app.inject({ method: "GET", url: "/bff/space/showing" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("is the same for everybody, which is the entire point", async () => {
    const { app, as, store } = boot();
    const projectId = store.createProject({ id: "nikk", kind: "human" }, { id: "p1", name: "One" });

    const set = await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie: as("nikk") },
      payload: { projectId },
    });
    expect(set.statusCode).toBe(200);

    const seen = await showingOf(app, as("baiwei"));
    expect(seen.showing.projectId).toBe(projectId);
    expect(seen.showing.setBy).toBe("nikk");
    await app.close();
  });

  it("refuses a project that does not exist, and says which", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie: as("nikk") },
      payload: { projectId: "not-a-project" },
    });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatch(/no project called "not-a-project"/);
    await app.close();
  });

  it("refuses a mood board from a different project", async () => {
    // Two fields of one choice. A board from somewhere else would put a wall
    // and a board in the room that have nothing to do with each other.
    const { app, as, store } = boot();
    const actor = { id: "nikk", kind: "human" } as const;
    const mine = store.createProject(actor, { id: "p1", name: "Mine" });
    const theirs = store.createProject(actor, { id: "p2", name: "Theirs" });
    const board = store.createBoard(actor, theirs, "Elsewhere");

    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie: as("nikk") },
      payload: { projectId: mine, boardId: board },
    });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatch(/not in that project/);
    await app.close();
  });

  it("refuses a mood board with no project at all", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie: as("nikk") },
      payload: { boardId: "some-board" },
    });
    expect(response.statusCode).toBe(422);
    expect(JSON.parse(response.body).error).toMatch(/without the project/);
    await app.close();
  });

  it("accepts null as a real answer: show nothing", async () => {
    const { app, as, store } = boot();
    const projectId = store.createProject({ id: "nikk", kind: "human" }, { id: "p1", name: "One" });
    const cookie = as("nikk");
    await app.inject({ method: "PUT", url: "/bff/space/showing", headers: { cookie }, payload: { projectId } });

    const cleared = await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie },
      payload: { projectId: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect((await showingOf(app, cookie)).showing.projectId).toBeNull();
    await app.close();
  });

  it("refuses a project id that is not a string rather than coercing it", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie: as("nikk") },
      payload: { projectId: 7 },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("leaves a trail an agent can read without having been watching", async () => {
    // The other half of "agents should be aware": one that was asleep when the
    // wall changed can still find out what happened and who did it.
    const { app, as, store, database } = boot();
    const projectId = store.createProject({ id: "nikk", kind: "human" }, { id: "p1", name: "One" });
    await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie: as("nikk") },
      payload: { projectId },
    });

    const row = database
      .prepare("SELECT actor_id, action, entity, before, after FROM audit WHERE entity = 'room-showing'")
      .get() as { actor_id: string; action: string; before: string; after: string };
    expect(row.actor_id).toBe("nikk");
    expect(row.action).toBe("update");
    expect(JSON.parse(row.before).projectId).toBeNull();
    expect(JSON.parse(row.after).projectId).toBe(projectId);
    await app.close();
  });

  it("tells an arriving viewer what the room is showing, without being asked", async () => {
    const { app, as, store, config, sessions } = boot();
    const projectId = store.createProject({ id: "nikk", kind: "human" }, { id: "p1", name: "One" });
    await app.inject({
      method: "PUT",
      url: "/bff/space/showing",
      headers: { cookie: as("nikk") },
      payload: { projectId },
    });
    void config;
    void sessions;
    // The welcome frame carries it; see server/space/socket.ts. Asserted
    // through the route here because the socket has its own test file, and
    // duplicating its harness would be a second way to be wrong about setup.
    const body = await showingOf(app, as("late-arrival"));
    expect(body.showing.projectId).toBe(projectId);
    await app.close();
  });
});
