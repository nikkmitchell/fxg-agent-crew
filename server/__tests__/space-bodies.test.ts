import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { buildServer } from "../index.js";
import { AgentBodies, registerBodyRoutes, type CatalogueLookup } from "../space/bodies.js";

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
    BLOB_ROOT: testBlobRoot(),
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
  it("points at the catalogue rather than just declining", async () => {
    const { app, as } = boot();
    const response = await mine(app, as("lumenrook", "agent"), { body: "Rook" });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("NO_SUCH_BODY");
    expect(response.json().error).toContain("catalogue.json");
    await app.close();
  });

  /**
   * THE ROUTE MUST SEE THE CATALOGUE, and this is the test that says so.
   *
   * It began as a bug caught on the live site rather than here. `chooseBody`
   * takes a catalogue lookup and I tested it WITH one; the route was tested
   * without, using a name that is genuinely absent. Both passed while the
   * deployed server answered NO_SUCH_BODY for AbissalDude — one of the 300.
   * A unit test of a function and a test of the route that calls it are not
   * the same test, and only the route is what anybody uses.
   *
   * Now that all 300 are wearable, the same wiring shows up as a body being
   * ACCEPTED. If the lookup is ever unhooked again, this fails.
   */
  it("accepts any of the 300, resolving a catalogue name to its slug", async () => {
    const { app, as } = boot();
    const response = await mine(app, as("Sill", "agent"), { body: "AbissalDude" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, body: "abissaldude" });
    // Nobody has looked at it, and the reply says so rather than implying a
    // recommendation.
    expect(response.json().looked).toBeNull();
    await app.close();
  });

  it("carries a fetched body through presence just like a committed one", async () => {
    const { app, as, space } = boot();
    space.presence.join("Corvid", "agent", false);
    await mine(app, as("Corvid", "agent"), { body: "CoolWaffle" });
    const read = await app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie: as("Nikk2") } });
    const corvid = read.json().people.find((one: { actorId: string }) => one.actorId === "Corvid");
    expect(corvid.body).toBe("coolwaffle");
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

  /**
   * Nightjar, the first agent to read the wardrobe cold, found its note saying
   * the other 285 were "not built yet" an hour after they were built, and only
   * tried one because they distrusted it. The note is computed now, and this
   * holds it to the behaviour by wearing a body that onHand does not list.
   */
  it("says how many can be worn, and wearing one outside onHand proves it", async () => {
    const { app, as } = boot();
    const listed = await app.inject({ method: "GET", url: "/bff/space/bodies", headers: { cookie: as("Nightjar", "agent") } });
    const body = listed.json();
    expect(body.note).not.toMatch(/not built/i);
    expect(body.note).toContain("onHand is not a limit");
    // The 300 in the catalogue, plus cool-fridge, which is on hand and predates it.
    expect(body.wearable).toBe(301);
    expect(body.note).toContain("Any of the 300 bodies in the catalogue can be worn, and so can the 1 on hand");
    expect(body.onHand.map((one: { slug: string }) => one.slug)).not.toContain("cutemoth");
    const outside = await mine(app, as("Nightjar", "agent"), { body: "CuteMoth" });
    expect(outside.statusCode).toBe(200);
    await app.close();
  });
});

/**
 * A SERVER THAT CANNOT READ THE CATALOGUE, tested at the route and not only in
 * the function.
 *
 * Production always passes a lookup. On a box whose catalogue file had gone
 * missing, that lookup would have known nothing, and every real body would
 * have been refused as "no body is called X", which is the false claim
 * NOT_SERVED_YET exists to prevent. A bare app is the only way to hand the
 * routes any lookup other than the real one.
 */
describe("a server that cannot read the catalogue", () => {
  const bare = async (inTheCatalogue: CatalogueLookup | undefined) => {
    const built = boot();
    const app = Fastify();
    await app.register(cookie);
    registerBodyRoutes(app, { config: built.config, sessions: built.sessions, bodies: new AgentBodies(built.database), inTheCatalogue });
    const wear = (body: string) =>
      app.inject({ method: "PUT", url: "/bff/space/body", headers: { cookie: built.as("Sill", "agent") }, payload: { body } });
    const wardrobe = async () =>
      (await app.inject({ method: "GET", url: "/bff/space/bodies", headers: { cookie: built.as("Sill", "agent") } })).json();
    return { wear, wardrobe, close: () => Promise.all([app.close(), built.app.close()]) };
  };
  const knowsNothing: CatalogueLookup = Object.assign(() => null, { size: () => 0 });

  for (const [what, lookup] of [
    ["handed a lookup that knows nothing", knowsNothing],
    ["handed no lookup at all", undefined],
  ] as const) {
    it(`says it cannot check a name, rather than that there is no such body, when ${what}`, async () => {
      const { wear, wardrobe, close } = await bare(lookup);
      const refused = await wear("AbissalDude");
      expect(refused.statusCode).toBe(400);
      expect(refused.json().code).toBe("NOT_SERVED_YET");
      // The fifteen on hand still work: this degrades, it does not break.
      expect((await wear("Shiro")).statusCode).toBe(200);
      const listed = await wardrobe();
      expect(listed.wearable).toBe(listed.onHand.length);
      expect(listed.note).toContain("cannot read the catalogue");
      await close();
    });
  }
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
