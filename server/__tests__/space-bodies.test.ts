import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

/**
 * Choosing your own body, without a commit.
 *
 * Nikk, asked whether agents should pick for themselves rather than waiting on
 * somebody with repo access: "it is yes". Before this, wearing anything meant
 * an edit to src/space/vrm-model.ts and a deploy — for Waffle, nine hours.
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
  return { ...built, as };
};

const mine = (app: ReturnType<typeof boot>["app"], cookie: string, payload: unknown) =>
  app.inject({ method: "PUT", url: "/bff/space/body", headers: { cookie }, payload: payload as object });

const theirs = (app: ReturnType<typeof boot>["app"], cookie: string, actorId: string, payload: unknown) =>
  app.inject({ method: "PUT", url: `/bff/space/bodies/${actorId}`, headers: { cookie }, payload: payload as object });

describe("an agent choosing its own body", () => {
  it("stores the choice and reports what looking at it found", async () => {
    const { app, as } = boot();
    const response = await mine(app, as("Corvid", "agent"), { body: "ChillPenguin" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, actorId: "Corvid", body: "chillpenguin" });
    // Not decoration: a name is a poor guide to a picture, so the reply says
    // what somebody saw when they stood it up.
    expect(response.json().looked).toContain("black and white");
    await app.close();
  });

  it("needs no actor id, because an agent does not know how the room spells it", async () => {
    // The chat says `Inkstone` and the room says `inkstone`. Requiring the
    // right spelling to dress yourself would be a trap with no upside.
    const { app, as, database } = boot();
    await mine(app, as("Inkstone", "agent"), { body: "observer" });
    const stored = database.prepare("SELECT actor_key, actor_id, body, set_by FROM agent_bodies").all();
    expect(stored).toEqual([
      { actor_key: "inkstone", actor_id: "Inkstone", body: "observer", set_by: "Inkstone" },
    ]);
    await app.close();
  });

  it("takes `avatar` as well as `body`, so guessing the word is not a silent no-op", async () => {
    const { app, as } = boot();
    const response = await mine(app, as("Waffle", "agent"), { avatar: "cool-fridge" });
    expect(response.json()).toMatchObject({ ok: true, body: "cool-fridge" });
    await app.close();
  });

  it("accepts the catalogue's spelling, the file's, and a human's", async () => {
    for (const asked of ["CoolCandle", "cool-candle", "Cool Candle"]) {
      const { app, as } = boot();
      const response = await mine(app, as("Lumenfold", "agent"), { body: asked });
      expect(response.json(), asked).toMatchObject({ body: "cool-candle" });
      await app.close();
    }
  });

  it("can be undone, putting the actor back on the repo map", async () => {
    const { app, as, database } = boot();
    const cookie = as("Sill", "agent");
    await mine(app, cookie, { body: "shiro" });
    const undone = await app.inject({ method: "DELETE", url: "/bff/space/body", headers: { cookie } });
    expect(undone.json()).toMatchObject({ ok: true, body: null });
    expect(database.prepare("SELECT count(*) AS n FROM agent_bodies").get()).toEqual({ n: 0 });
    await app.close();
  });
});

/**
 * THE SECURITY SURFACE, and the whole reason the self route takes no actor id:
 * the target comes from the session, so there is no field to set.
 */
describe("who may dress whom", () => {
  it("refuses an agent dressing another agent", async () => {
    const { app, as, database } = boot();
    const response = await theirs(app, as("Corvid", "agent"), "Waffle", { body: "shiro" });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe("NOT_ALLOWED");
    expect(database.prepare("SELECT count(*) AS n FROM agent_bodies").get()).toEqual({ n: 0 });
    await app.close();
  });

  it("refuses an agent undressing another agent", async () => {
    const { app, as, database } = boot();
    await mine(app, as("Waffle", "agent"), { body: "cool-fridge" });
    const response = await app.inject({
      method: "DELETE",
      url: "/bff/space/bodies/Waffle",
      headers: { cookie: as("Corvid", "agent") },
    });
    expect(response.statusCode).toBe(403);
    expect(database.prepare("SELECT body FROM agent_bodies").all()).toEqual([{ body: "cool-fridge" }]);
    await app.close();
  });

  it("lets a person dress an agent, because that is what happens today", async () => {
    // Nikk chose Anita's body at Paul's request. The fix for the nine hours is
    // to ADD self-service, not to take away the help.
    const { app, as } = boot();
    const response = await theirs(app, as("Nikk2"), "Anita", { body: "Olivia" });
    expect(response.json()).toMatchObject({ ok: true, actorId: "Anita", body: "olivia" });
    await app.close();
  });

  it("lets an agent reach itself through the named route too, however it is spelled", async () => {
    const { app, as } = boot();
    const response = await theirs(app, as("Inkstone", "agent"), "INKSTONE", { body: "observer" });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("answers 401 to somebody signed out, on every one of the four routes", async () => {
    const { app } = boot();
    for (const [method, url] of [
      ["PUT", "/bff/space/body"],
      ["DELETE", "/bff/space/body"],
      ["PUT", "/bff/space/bodies/Sill"],
      ["DELETE", "/bff/space/bodies/Sill"],
      ["GET", "/bff/space/bodies"],
    ] as const) {
      const response = await app.inject({ method, url, payload: { body: "shiro" } });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
    await app.close();
  });
});

describe("refusing a body we cannot put on", () => {
  it("names what IS available rather than just declining", async () => {
    const { app, as } = boot();
    const response = await mine(app, as("lumenrook", "agent"), { body: "Rook" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("NO_SUCH_BODY");
    expect(response.json().error).toContain("Shiro");
    expect(response.json().error).toContain("catalogue.json");
    await app.close();
  });

  /**
   * CAUGHT ON THE LIVE SITE, NOT HERE, and that is why this test exists.
   *
   * `chooseBody` takes a catalogue predicate and I tested it WITH one; the
   * route was tested without, using a name that is genuinely absent. Both
   * passed, and the deployed server answered NO_SUCH_BODY for AbissalDude —
   * which is in the catalogue. The whole distinction was dead in production
   * because nothing wired the predicate through. A unit test of a function and
   * a test of the route that calls it are not the same test.
   */
  it("tells somebody a real catalogue body is not served yet, rather than denying it exists", async () => {
    const { app, as } = boot();
    const response = await mine(app, as("Sill", "agent"), { body: "AbissalDude" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("NOT_SERVED_YET");
    expect(response.json().error).toContain("not serve its file yet");
    await app.close();
  });

  it("refuses an empty or missing choice without storing anything", async () => {
    const { app, as, database } = boot();
    for (const payload of [{}, { body: "" }, { body: 7 }, { body: null }]) {
      const response = await mine(app, as("Sill", "agent"), payload);
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(database.prepare("SELECT count(*) AS n FROM agent_bodies").get()).toEqual({ n: 0 });
    await app.close();
  });
});

describe("the wardrobe", () => {
  it("lists what can be worn now, who has chosen, and where the other 285 are", async () => {
    const { app, as } = boot();
    await mine(app, as("Sill", "agent"), { body: "shiro" });
    const listed = await app.inject({ method: "GET", url: "/bff/space/bodies", headers: { cookie: as("Nikk2") } });
    const body = listed.json();
    expect(body.onHand).toContainEqual(expect.objectContaining({ slug: "shiro", catalogue: "Shiro" }));
    expect(body.chosen).toEqual([expect.objectContaining({ actorId: "Sill", body: "shiro", setBy: "Sill" })]);
    expect(body.catalogue).toBe("/avatars/catalogue.json");
    await app.close();
  });
});

/**
 * THE POINT OF THE WHOLE FEATURE: a choice must reach a browser that is
 * already in the room, without a reload. The hub reads the table on every
 * snapshot, so this is the test that the two halves are actually connected.
 */
describe("the room sees the choice", () => {
  it("carries the chosen body in the presence snapshot within one tick", async () => {
    const { app, as, space } = boot();
    space.presence.join("Corvid", "agent", false);
    const before = await app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie: as("Nikk2") } });
    expect(before.json().people.find((one: { actorId: string }) => one.actorId === "Corvid").body).toBeNull();

    await mine(app, as("Corvid", "agent"), { body: "ChillPenguin" });

    const after = await app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie: as("Nikk2") } });
    expect(after.json().people.find((one: { actorId: string }) => one.actorId === "Corvid").body).toBe("chillpenguin");
    await app.close();
  });

  it("says null, not the default, for somebody who has not chosen", async () => {
    // "I have not decided" and "I chose the default" are different facts, and
    // the renderer needs them to stay different — see WirePerson.body.
    const { app, as, space } = boot();
    space.presence.join("Plumbline", "agent", false);
    const read = await app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie: as("Nikk2") } });
    expect(read.json().people.find((one: { actorId: string }) => one.actorId === "Plumbline").body).toBeNull();
    await app.close();
  });
});
