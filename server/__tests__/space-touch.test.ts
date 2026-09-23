import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

/** Nikk: "Allow for touching agents, agents can decide what they think of the touch". */
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

const touch = (app: ReturnType<typeof boot>["app"], cookie: string, agentId: string, part: string) =>
  app.inject({ method: "POST", url: "/bff/space/touch", headers: { cookie }, payload: { agentId, part } });

describe("touching an agent", () => {
  it("makes the agent react the way it chose, and records who touched it where", async () => {
    const { app, as, space } = boot();
    space.presence.join("Sill", "agent", false);
    const sill = as("Sill", "agent");
    const set = await app.inject({ method: "PUT", url: "/bff/space/touch-preferences", headers: { cookie: sill }, payload: { head: "likes", hand: "dislikes" } });
    expect(set.statusCode).toBe(200);

    const pat = await touch(app, as("Nikk2"), "Sill", "head");
    expect(pat.json().touch).toEqual(expect.objectContaining({ agentId: "Sill", by: "Nikk2", part: "head", feeling: "likes" }));
    expect(space.presence.find("Sill")!.avatar.mood).toBe("happy");

    const grab = await touch(app, as("baiwei2"), "Sill", "hand");
    expect(grab.json().touch.feeling).toBe("dislikes");
    expect(space.presence.find("Sill")!.avatar.gesture).toBe("disagree");

    const seen = await app.inject({ method: "GET", url: "/bff/space/touches?since=0&agent=Sill", headers: { cookie: sill } });
    expect(seen.json().touches.map((t: { by: string }) => t.by)).toEqual(["Nikk2", "baiwei2"]);
    await app.close();
  });

  it("nods neutrally when the agent has said nothing about it", async () => {
    const { app, as, space } = boot();
    space.presence.join("Inkstone", "agent", false);
    const response = await touch(app, as("Nikk2"), "Inkstone", "shoulder");
    expect(response.json().touch.feeling).toBe("neutral");
    expect(space.presence.find("Inkstone")!.avatar.gesture).toBe("nod");
    await app.close();
  });

  it("counts a hand resting on an agent as one touch, not one a frame", async () => {
    const { app, as, space } = boot();
    space.presence.join("Sill", "agent", false);
    const cookie = as("Nikk2");
    expect((await touch(app, cookie, "Sill", "head")).json().touch).not.toBeNull();
    expect((await touch(app, cookie, "Sill", "head")).json().touch).toBeNull();
    await app.close();
  });

  it("lets only an agent choose its own feelings, and never touches a person", async () => {
    const { app, as, space } = boot();
    const byPerson = await app.inject({ method: "PUT", url: "/bff/space/touch-preferences", headers: { cookie: as("Nikk2") }, payload: { head: "likes" } });
    expect(byPerson.statusCode).toBe(403);
    const bad = await app.inject({ method: "PUT", url: "/bff/space/touch-preferences", headers: { cookie: as("Sill", "agent") }, payload: { head: "adores" } });
    expect(bad.statusCode).toBe(400);
    space.presence.join("baiwei2", "human", true);
    expect((await touch(app, as("Nikk2"), "baiwei2", "head")).json().touch).toBeNull();
    await app.close();
  });

  it("refuses anyone not signed in, and a part that is not a part", async () => {
    const { app, as } = boot();
    expect((await app.inject({ method: "POST", url: "/bff/space/touch", payload: { agentId: "Sill", part: "head" } })).statusCode).toBe(401);
    expect((await touch(app, as("Nikk2"), "Sill", "tail")).statusCode).toBe(400);
    await app.close();
  });
});
