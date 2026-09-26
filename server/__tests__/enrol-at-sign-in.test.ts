import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "../index.js";
import { BoardStore } from "../db/store.js";
import { tempDir } from "./test-config.js";

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
    BLOB_ROOT: tempDir("blobs-"),
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

/**
 * A PERSON is enrolled the same way. This half was missing: only
 * /bff/agent-session ever enrolled anybody, so every human who signed in with a
 * password met PROJECT_PERMISSION_REQUIRED on their first card. Baiwei, in the
 * saha.ing room, could not edit the saha.ing board. Nikk: "why can't baiwei
 * access the workboard, anyone who is here should be able to access".
 */
const upstreamForPeople = (username: string, rooms: string[] | Error) =>
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/api/login")) {
      return new Response(JSON.stringify({ token: `token-for-${username}` }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (String(url).includes("/api/rooms")) {
      if (rooms instanceof Error) return new Response("upstream is sulking", { status: 502 });
      return new Response(JSON.stringify({ rooms: rooms.map((roomName) => ({ roomName })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: 2, username, kind: "human" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }));

const logIn = (app: ReturnType<typeof boot>["app"], username: string) =>
  app.inject({ method: "POST", url: "/bff/login", payload: { username, password: "correct horse" } });

describe("a PERSON in the room is enrolled when they sign in", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("joins the linked project, exactly as an agent does", async () => {
    upstreamForPeople("baiwei2", ["saha.ing"]);
    const { app, membership } = boot();
    expect((await logIn(app, "baiwei2")).statusCode).toBe(200);
    expect(membership("baiwei2")).toEqual({ roles: "[]", active: 1 });
    await app.close();
  });

  /** "Anyone in the space" means anyone in THIS room, not anyone anywhere. */
  it("does not enrol a person who is only in other rooms", async () => {
    upstreamForPeople("Elsewhere", ["their-own-room"]);
    const { app, membership } = boot();
    expect((await logIn(app, "Elsewhere")).statusCode).toBe(200);
    expect(membership("Elsewhere")).toBeUndefined();
    await app.close();
  });

  it("signs the person in anyway when upstream cannot say which rooms they are in", async () => {
    upstreamForPeople("baiwei2", new Error("down"));
    const { app, membership } = boot();
    expect((await logIn(app, "baiwei2")).statusCode).toBe(200);
    expect(membership("baiwei2")).toBeUndefined();
    await app.close();
  });

  /** The one rule this path promises, for people too. */
  it("does not undo a membership a manager revoked", async () => {
    upstreamForPeople("baiwei2", ["saha.ing"]);
    const { app, membership, database, store } = boot();
    store.ensureActor("Baiwei2", "human");
    database
      .prepare("INSERT INTO memberships (project_id, actor_id, roles, active, granted_by, granted_at) VALUES (?,?,?,?,?,?)")
      .run("saha-ing", "Baiwei2", "[]", 0, "Nikk2", new Date().toISOString());
    expect((await logIn(app, "baiwei2")).statusCode).toBe(200);
    // Still the one revoked row, under its original spelling: nothing re-added.
    expect(membership("baiwei2")).toBeUndefined();
    expect(membership("Baiwei2")).toEqual({ roles: "[]", active: 0 });
    await app.close();
  });

  /**
   * SESSIONS THAT PREDATE THE FIX. A session lasts days, so somebody already
   * signed in must not stay locked out until they happen to sign out: their
   * next page load, which asks /bff/me, enrols them.
   */
  it("enrols somebody already signed in, on their next page load", async () => {
    upstreamForPeople("baiwei2", ["saha.ing"]);
    const { app, membership, sessions, config } = boot();
    const sid = sessions.create("baiwei2", "an-old-token");
    expect(membership("baiwei2")).toBeUndefined();
    const me = await app.inject({ method: "GET", url: "/bff/me", headers: { cookie: `${config.cookieName}=${sid}` } });
    expect(me.statusCode).toBe(200);
    await vi.waitFor(() => expect(membership("baiwei2")).toEqual({ roles: "[]", active: 1 }));
    await app.close();
  });

  it("asks upstream about a session's rooms once, not on every page load", async () => {
    upstreamForPeople("baiwei2", ["saha.ing"]);
    const { app, sessions, config } = boot();
    const sid = sessions.create("baiwei2", "an-old-token");
    const headers = { cookie: `${config.cookieName}=${sid}` };
    for (let load = 0; load < 5; load += 1) await app.inject({ method: "GET", url: "/bff/me", headers });
    await vi.waitFor(() => {
      const roomCalls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([url]) =>
        String(url).includes("/api/rooms"),
      );
      expect(roomCalls).toHaveLength(1);
    });
    await app.close();
  });
});
