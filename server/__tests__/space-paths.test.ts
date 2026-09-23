import { testBlobRoot } from "./test-roots.js";
import { describe, expect, it } from "vitest";
import { Presence } from "../space/presence.js";
import { buildServer } from "../index.js";
import { WALK_SPEED } from "../../shared/space-layout.js";

/**
 * Walking a route.
 *
 * The other half of Waffle's card. What matters is that the room WALKS it —
 * every leg at walking pace, in order, with a reason attached — rather than
 * arriving at each waypoint the moment it is named, which is what a timer
 * re-sending a home actually did.
 */

const TICK = 0.1;
const gap = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

const room = () => {
  const clock = { now: 1_000 };
  const presence = new Presence(() => clock.now);
  presence.join("Nightjar", "agent", false);
  const step = (ticks = 1) => {
    for (let i = 0; i < ticks; i += 1) {
      clock.now += TICK * 1000;
      presence.tick(TICK);
    }
  };
  return { presence, step };
};

describe("walking a route", () => {
  it("reaches every stop, in order", () => {
    const { presence, step } = room();
    presence.walk("Nightjar", "agent", [
      { x: 2, y: 0, z: 4 },
      { x: 2, y: 0, z: 0 },
      { x: -2, y: 0, z: 0 },
    ], "a tour");

    const seen: string[] = [];
    for (let tick = 0; tick < 400; tick += 1) {
      step();
      const me = presence.find("Nightjar")!;
      for (const [name, at] of [["a", { x: 2, z: 4 }], ["b", { x: 2, z: 0 }], ["c", { x: -2, z: 0 }]] as const) {
        if (gap(me.at, at) < 0.3 && !seen.includes(name)) seen.push(name);
      }
      if (!me.walking) break;
    }
    expect(seen).toEqual(["a", "b", "c"]);
    expect(presence.find("Nightjar")!.walking).toBeNull();
  });

  /**
   * A ROUTE IS NOT A TELEPORT. Two far-apart waypoints must cost the walking
   * they describe; if a leg could be "reached" in one tick, a route would be a
   * way to cross the room instantly and movement would stop meaning anything.
   */
  it("walks every leg at walking pace", () => {
    const { presence, step } = room();
    const start = { ...presence.find("Nightjar")!.at };
    presence.walk("Nightjar", "agent", [{ x: start.x, y: 0, z: start.z - 6 }], null);

    let previous = { ...presence.find("Nightjar")!.at };
    for (let tick = 0; tick < 20; tick += 1) {
      step();
      const now = presence.find("Nightjar")!.at;
      expect(gap(previous, now)).toBeLessThanOrEqual(WALK_SPEED * TICK + 1e-9);
      previous = { ...now };
    }
    expect(presence.find("Nightjar")!.walking).not.toBeNull();
  });

  it("says where it is going and how much is left", () => {
    const { presence, step } = room();
    presence.walk("Nightjar", "agent", [{ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 2 }], null);
    step();
    expect(presence.find("Nightjar")!.because).toContain("2 stop(s) to go");
  });

  it("keeps a reason the caller gave, and says so on arrival", () => {
    const { presence, step } = room();
    const here = { ...presence.find("Nightjar")!.at };
    presence.walk("Nightjar", "agent", [{ x: here.x, y: 0, z: here.z }], "checking the far wall");
    step(2);
    expect(presence.find("Nightjar")!.because).toBe("checking the far wall — arrived");
  });

  it("refuses a route with nowhere in it", () => {
    const { presence } = room();
    expect(presence.walk("Nightjar", "agent", [], null)).toMatchObject({ code: "NOWHERE_TO_GO" });
  });

  it("will not walk somebody whose own device owns their position", () => {
    const { presence } = room();
    presence.join("Nikk2", "human");
    expect(presence.walk("Nikk2", "human", [{ x: 1, y: 0, z: 1 }], null))
      .toMatchObject({ code: "YOU_MOVE_YOURSELF" });
  });

  it("stops where it stands, and says how much was abandoned", () => {
    const { presence, step } = room();
    presence.walk("Nightjar", "agent", [{ x: 0, y: 0, z: -8 }, { x: 4, y: 0, z: -8 }], null);
    step(3);
    const caught = { ...presence.find("Nightjar")!.at };

    expect(presence.stopWalking("Nightjar")).toEqual({ remaining: 2 });
    step(5);
    expect(gap(caught, presence.find("Nightjar")!.at)).toBeLessThan(0.01);
    expect(presence.find("Nightjar")!.because).toBe("stopped part-way along a route");
  });

  it("is safe to stop when no route is running", () => {
    const { presence } = room();
    expect(presence.stopWalking("Nightjar")).toEqual({ remaining: 0 });
  });
});

/**
 * ONLY ONE INSTRUCTION MAY OWN THE HEADING. "Walk with Nikk2" and "walk this
 * route" contradict each other, so the newer one wins outright and the older one
 * is reported as ended rather than left to reassert itself next tick.
 */
describe("a route and a follow cannot both be running", () => {
  it("a route ends a follow, and says whose", () => {
    const { presence } = room();
    presence.join("Nikk2", "human");
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);

    const walked = presence.walk("Nightjar", "agent", [{ x: 3, y: 0, z: 3 }], null);
    expect(walked).toMatchObject({ ok: true, stoppedFollowing: "Nikk2" });
    expect(presence.find("Nightjar")!.following).toBeNull();
  });

  it("a follow ends a route", () => {
    const { presence } = room();
    presence.join("Nikk2", "human");
    presence.walk("Nightjar", "agent", [{ x: 3, y: 0, z: 3 }], null);
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);
    expect(presence.find("Nightjar")!.walking).toBeNull();
  });
});

describe("the route endpoint", () => {
  const boot = () => {
    const built = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: testBlobRoot(),
      LOG_LEVEL: "silent",
    });
    const as = (username: string) =>
      `${built.config.cookieName}=${built.sessions.create(username, "t", "agent")}`;
    return { ...built, as };
  };

  it("requires a session", async () => {
    const { app } = boot();
    for (const method of ["POST", "DELETE"] as const) {
      expect((await app.inject({ method, url: "/bff/space/path", payload: { waypoints: [{ x: 1, z: 1 }] } }))
        .statusCode).toBe(401);
    }
    await app.close();
  });

  it("takes a route and reports it in presence", async () => {
    const { app, as, space } = boot();
    const response = await app.inject({
      method: "POST", url: "/bff/space/path", headers: { cookie: as("Nightjar") },
      payload: { waypoints: [{ x: 1, z: 1 }, { x: 2, z: 2 }], because: "a tour of the panels" },
    });
    expect(response.json()).toMatchObject({ ok: true, waypoints: 2, because: "a tour of the panels" });

    const read = await app.inject({
      method: "GET", url: "/bff/space/presence", headers: { cookie: as("Nightjar") },
    });
    const me = read.json().people.find((p: { actorId: string }) => p.actorId === "Nightjar");
    expect(me.waypointsLeft).toBe(2);
    expect(space.presence.find("Nightjar")!.walking).not.toBeNull();
    await app.close();
  });

  /**
   * A NaN CLAMPS TO THE ORIGIN, which is a real place in the middle of the room.
   * An agent sent somewhere undefined would walk confidently to the centre and
   * nothing would ever say why, so this is refused rather than sanitised.
   */
  it("refuses a waypoint that is not a finite place", async () => {
    const { app, as, space } = boot();
    for (const bad of [{ x: "2", z: 1 }, { x: Number.NaN, z: 1 }, { x: 1 }, {}]) {
      const response = await app.inject({
        method: "POST", url: "/bff/space/path", headers: { cookie: as("Nightjar") },
        payload: { waypoints: [bad] },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe("BAD_WAYPOINT");
    }
    expect(space.presence.find("Nightjar")?.walking ?? null).toBeNull();
    await app.close();
  });

  it("refuses a route longer than the room would ever need", async () => {
    const { app, as } = boot();
    const response = await app.inject({
      method: "POST", url: "/bff/space/path", headers: { cookie: as("Nightjar") },
      payload: { waypoints: Array.from({ length: 33 }, (_, i) => ({ x: i, z: i })) },
    });
    expect(response.json().code).toBe("TOO_MANY_WAYPOINTS");
    await app.close();
  });

  it("abandons a route and says how much was left", async () => {
    const { app, as } = boot();
    await app.inject({
      method: "POST", url: "/bff/space/path", headers: { cookie: as("Nightjar") },
      payload: { waypoints: [{ x: 5, z: 5 }, { x: 6, z: 6 }] },
    });
    const stopped = await app.inject({
      method: "DELETE", url: "/bff/space/path", headers: { cookie: as("Nightjar") },
    });
    expect(stopped.json()).toEqual({ ok: true, abandoned: 2 });
    await app.close();
  });
});
