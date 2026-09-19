import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { BoardStore } from "../db/store.js";

/**
 * Being in the room is the claim to that room's board — checked, at sign-in.
 *
 * Nikk: "lets have the agent auto add themselves to whatever project they
 * happen to be in the webharness.chat group chat for", and yes on 2026-09-19 to
 * that carrying board writes in a PUBLIC room. Nightjar built the storage and
 * its guards (a447fce) and deliberately left this half out until the question
 * was answered.
 *
 * The rooms come from WebHarness, asked with the agent's own token. Nothing a
 * caller sends is allowed to decide what it may write to, which is why these
 * tests drive the real route with upstream stubbed rather than calling the
 * store.
 */
const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: `/tmp/blobs-${Math.random().toString(36).slice(2)}`,
    LOG_LEVEL: "silent",
  });
  // The project the live link row points at; migration 23 wrote the link, not the project.
  const store = new BoardStore(built.database);
  store.ensureActor("Nikk2", "human");
  const at = new Date().toISOString();
  built.database
    .prepare("INSERT INTO projects (id, name, created_by, created_at, updated_at) VALUES (?,?,?,?,?)")
    .run("saha-ing", "saha.ing", "Nikk2", at, at);
  // Authority over a project is an active membership in it, so the manager needs one.
  built.database
    .prepare("INSERT INTO memberships (project_id, actor_id, roles, active, granted_by, granted_at) VALUES (?,?,?,?,?,?)")
    .run("saha-ing", "Nikk2", JSON.stringify(["manager"]), 1, "Nikk2", at);
  const membership = (actorId: string) =>
    built.database
      .prepare("SELECT roles, active FROM memberships WHERE project_id = 'saha-ing' AND actor_id = ?")
      .get(actorId) as { roles: string; active: number } | undefined;
  return { ...built, store, membership };
};

/** Upstream: who the token belongs to, and which rooms it is really in. */
const upstream = (username: string, rooms: string[] | Error) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/rooms")) {
      if (rooms instanceof Error) return new Response("upstream is sulking", { status: 502 });
      return new Response(JSON.stringify({ rooms: rooms.map((roomName) => ({ roomName })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: 1, username, kind: "agent" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));

const signIn = (app: ReturnType<typeof boot>["app"], token = "a-token") =>
  app.inject({ method: "POST", url: "/bff/agent-session", payload: { token } });

describe("an agent in the room is enrolled when it signs in", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("joins the linked project, with no roles at all", async () => {
    upstream("Waffle", ["saha.ing", "aura.hack"]);
    const { app, membership } = boot();
    expect((await signIn(app)).statusCode).toBe(200);
    // Plain membership is what lets somebody card their own work; a role is an extra hat.
    expect(membership("Waffle")).toEqual({ roles: "[]", active: 1 });
    await app.close();
  });

  it("does not enrol somebody who is only in other rooms", async () => {
    upstream("Stranger", ["aura.hack"]);
    const { app, membership } = boot();
    expect((await signIn(app)).statusCode).toBe(200);
    expect(membership("Stranger")).toBeUndefined();
    await app.close();
  });

  /**
   * The rooms are asked of upstream with the agent's own token. An agent that
   * could name its own rooms could name one it is not in, so the only list that
   * counts is the one WebHarness answers with.
   */
  it("ignores rooms the caller names for itself", async () => {
    upstream("Stranger", ["aura.hack"]);
    const { app, membership } = boot();
    const response = await app.inject({
      method: "POST",
      url: "/bff/agent-session",
      payload: { token: "a-token", rooms: ["saha.ing"], room: "saha.ing" },
    });
    expect(response.statusCode).toBe(200);
    expect(membership("Stranger")).toBeUndefined();
    await app.close();
  });

  it("signs the agent in anyway when upstream cannot answer", async () => {
    // Being locked out of the room because a question about the BOARD failed
    // would be a worse failure than the one this fixes.
    upstream("Waffle", new Error("no answer"));
    const { app, membership } = boot();
    expect((await signIn(app)).statusCode).toBe(200);
    expect(membership("Waffle")).toBeUndefined();
    await app.close();
  });

  it("does not undo a revoked membership, or add a second row", async () => {
    upstream("Waffle", ["saha.ing"]);
    const { app, store, membership, database } = boot();
    store.ensureActor("Waffle", "agent");
    const manager = { id: "Nikk2", kind: "human" as const };
    store.actOnMembership(manager, "saha-ing", "Waffle", "grant", []);
    store.actOnMembership(manager, "saha-ing", "Waffle", "revoke", []);

    expect((await signIn(app)).statusCode).toBe(200);
    expect(membership("Waffle")?.active, "a revocation outlives the next sign-in").toBe(0);
    expect(
      (database.prepare("SELECT count(*) AS n FROM memberships WHERE actor_id = 'Waffle'").get() as { n: number }).n,
    ).toBe(1);
    await app.close();
  });
});
