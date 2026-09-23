import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";

/**
 * The follow endpoint.
 *
 * The behaviour is tested in following.test.ts; what matters here is the surface
 * an agent actually calls — that identity comes from the session and never from
 * the body, that a refusal says which of several things was wrong, and that
 * stopping twice is not an error.
 */

const boot = () => {
  const built = buildServer({
    WEBHARNESS_URL: "https://example.test",
    DATABASE_PATH: ":memory:",
    BLOB_ROOT: testBlobRoot(),
    LOG_LEVEL: "silent",
  });
  const as = (username: string, kind: "human" | "agent" = "agent") =>
    `${built.config.cookieName}=${built.sessions.create(username, "t", kind)}`;
  return { ...built, as };
};

describe("walking with somebody, over HTTP", () => {
  it("requires a session", async () => {
    const { app } = boot();
    for (const method of ["POST", "DELETE"] as const) {
      const response = await app.inject({ method, url: "/bff/space/follow", payload: { actor: "Nikk2" } });
      expect(response.statusCode).toBe(401);
    }
    await app.close();
  });

  it("follows the person named in the body, as the session's own actor", async () => {
    const { app, as, space } = boot();
    space.presence.join("Nikk2", "human");

    const response = await app.inject({
      method: "POST",
      url: "/bff/space/follow",
      headers: { cookie: as("Nightjar") },
      payload: { actor: "Nikk2", side: "left", because: "walking you to the door" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      ok: true, following: "Nikk2", side: "left", because: "walking you to the door",
    });
    expect(space.presence.find("Nightjar")?.following?.actorId).toBe("Nikk2");
    await app.close();
  });

  /**
   * THERE IS NO WAY TO MAKE SOMEBODY ELSE FOLLOW. An actor field that named the
   * follower would be this room's first mechanism for moving another actor, so
   * the only actor the body can name is the one being followed.
   */
  it("cannot start a follow on another agent's behalf", async () => {
    const { app, as, space } = boot();
    space.presence.join("Nikk2", "human");
    space.presence.join("Sill", "agent", false);

    await app.inject({
      method: "POST",
      url: "/bff/space/follow",
      headers: { cookie: as("Nightjar") },
      // Every spelling somebody might try to puppet a colleague with.
      payload: { actor: "Nikk2", follower: "Sill", actorId: "Sill", as: "Sill" },
    });

    expect(space.presence.find("Sill")?.following).toBeNull();
    expect(space.presence.find("Nightjar")?.following?.actorId).toBe("Nikk2");
    await app.close();
  });

  it("names what to send when the body is empty", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "POST", url: "/bff/space/follow", headers: { cookie: as("Nightjar") }, payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("BAD_FOLLOW");
    expect(response.json().error).toContain('"actor"');
    await app.close();
  });

  it("refuses a side it does not understand rather than choosing one", async () => {
    const { app, as, space } = boot();
    space.presence.join("Nikk2", "human");
    const response = await app.inject({
      method: "POST",
      url: "/bff/space/follow",
      headers: { cookie: as("Nightjar") },
      payload: { actor: "Nikk2", side: "port" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().code).toBe("BAD_SIDE");
    // Not in the room at all is a stronger pass than in it and not following:
    // a refused request must not have joined anybody to the space either.
    expect(space.presence.find("Nightjar")?.following ?? null).toBeNull();
    await app.close();
  });

  it("picks a side when none is given, and says which", async () => {
    const { app, as, space } = boot();
    space.presence.join("Nikk2", "human");
    const response = await app.inject({
      method: "POST", url: "/bff/space/follow", headers: { cookie: as("Nightjar") }, payload: { actor: "Nikk2" },
    });
    expect(["left", "right"]).toContain(response.json().side);
    await app.close();
  });

  it("answers 409 for somebody who is not in the room, and says so", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "POST", url: "/bff/space/follow", headers: { cookie: as("Nightjar") }, payload: { actor: "Waffle" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "NOT_IN_THE_ROOM", error: "Waffle is not in the room" });
    await app.close();
  });

  it("stops, and reports who it had been walking with", async () => {
    const { app, as, space } = boot();
    space.presence.join("Nikk2", "human");
    await app.inject({
      method: "POST", url: "/bff/space/follow", headers: { cookie: as("Nightjar") }, payload: { actor: "Nikk2" },
    });

    const stopped = await app.inject({
      method: "DELETE", url: "/bff/space/follow", headers: { cookie: as("Nightjar") },
    });
    expect(stopped.json()).toEqual({ ok: true, stoppedFollowing: "Nikk2" });
    await app.close();
  });

  it("is not an error to stop twice, so a lost reply can be retried", async () => {
    const { app, as } = boot();
    const again = await app.inject({
      method: "DELETE", url: "/bff/space/follow", headers: { cookie: as("Nightjar") },
    });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ ok: true, stoppedFollowing: null });
    await app.close();
  });

  it("shows up in presence, so a follow is visible rather than a coincidence", async () => {
    const { app, as, space } = boot();
    space.presence.join("Nikk2", "human");
    await app.inject({
      method: "POST", url: "/bff/space/follow", headers: { cookie: as("Nightjar") }, payload: { actor: "Nikk2" },
    });

    const read = await app.inject({
      method: "GET", url: "/bff/space/presence", headers: { cookie: as("Nikk2", "human") },
    });
    const me = read.json().people.find((person: { actorId: string }) => person.actorId === "Nightjar");
    expect(me.following).toBe("Nikk2");
    expect(me.because).toBe("walking with Nikk2");
    await app.close();
  });
});
