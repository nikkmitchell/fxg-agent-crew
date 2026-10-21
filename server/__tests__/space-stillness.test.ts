import { describe, expect, it } from "vitest";
import { buildServer } from "../index.js";
import { Presence } from "../space/presence.js";
import { SpaceHub } from "../space/socket.js";
import { tempDir } from "./test-config.js";

/**
 * Nikk: "an option to hide avatars that have not moved in more than 5 minutes
 * (though don't hide them automatically)". The browser hides; the server says
 * how long each person has been still, because it is the one that has been
 * watching. See shared/stillness.ts for what counts as moving.
 */
const MINUTE = 60_000;

describe("the snapshot says how long each person has been still", () => {
  it("counts up while nothing about them changes, and starts again when they gesture", () => {
    let clock = 1_000_000;
    const presence = new Presence(() => clock);
    const hub = new SpaceHub(presence, () => null, () => clock);
    presence.join("Corvid", "agent", false);
    const stillOf = () => hub.snapshot().find((one) => one.actorId === "Corvid")?.stillForMs;

    expect(stillOf(), "the first look can only say they have just been seen").toBe(0);
    clock += 6 * MINUTE;
    expect(stillOf()).toBe(6 * MINUTE);
    presence.animate("Corvid", { gesture: "wave" }, "agent");
    expect(stillOf()).toBe(0);
    hub.close();
  });

  it("gives the same answer however many times it is asked", () => {
    // The tick, the presence route and every arrival all call snapshot(). None
    // of them may make anybody look stiller, or livelier, than they are.
    let clock = 0;
    const presence = new Presence(() => clock);
    const hub = new SpaceHub(presence, () => null, () => clock);
    presence.join("Vint", "agent", false);
    hub.snapshot();
    clock += 7 * MINUTE;
    const first = hub.snapshot().find((one) => one.actorId === "Vint")?.stillForMs;
    const again = hub.snapshot().find((one) => one.actorId === "Vint")?.stillForMs;
    expect(first).toBe(7 * MINUTE);
    expect(again).toBe(first);
    hub.close();
  });

  it("reaches the browser: GET /bff/space/presence carries it for everybody", async () => {
    const built = buildServer({
      WEBHARNESS_URL: "https://example.test",
      DATABASE_PATH: ":memory:",
      BLOB_ROOT: tempDir("blobs-"),
      LOG_LEVEL: "silent",
    });
    built.space.presence.join("Corvid", "agent", false);
    const cookie = `${built.config.cookieName}=${built.sessions.create("Nikk2", "t", "human")}`;
    const response = await built.app.inject({ method: "GET", url: "/bff/space/presence", headers: { cookie } });
    const people = response.json().people as { actorId: string; stillForMs?: unknown }[];
    expect(people.length).toBeGreaterThan(0);
    for (const one of people) expect(typeof one.stillForMs, one.actorId).toBe("number");
    await built.app.close();
  });
});

describe("the snapshot's numbers", () => {
  it("go out to four decimals: a tenth of a millimetre, ten times a second to everyone", () => {
    let clock = 0;
    const presence = new Presence(() => clock);
    const hub = new SpaceHub(presence, () => null, () => clock);
    presence.join("Nikk2", "human", true);
    const pose = { p: { x: 0.123456789, y: 1.6123456789, z: -2.987654321 }, q: { x: 0.1111111, y: -0.2222222, z: 0.3333333, w: 0.9012345678 } };
    presence.moveSelf("Nikk2", { x: 1.23456789, y: 0, z: -3.3333333 }, 0.987654321,
      { head: pose, hands: { left: { ...pose, f: Array(20).fill(0.5) }, right: null } });
    const me = hub.snapshot().find((one) => one.actorId === "Nikk2")!;
    expect(me.at).toMatchObject({ x: 1.2346, z: -3.3333 });
    expect(me.facing).toBe(0.9877);
    expect(me.head).toEqual({ p: { x: 0.1235, y: 1.6123, z: -2.9877 }, q: { x: 0.1111, y: -0.2222, z: 0.3333, w: 0.9012 } });
    expect(me.hands.left?.f).toHaveLength(20);
    expect(me.hands.left?.q.w).toBe(0.9012);
    expect(me.hands.right).toBeNull();
    hub.close();
  });
});
