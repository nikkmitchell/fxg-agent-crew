import { describe, expect, it } from "vitest";
import { Presence, STALE_AFTER_MS } from "../space/presence.js";
import { ROOM, WALK_SPEED, deskFor } from "../../shared/space-layout.js";

/**
 * Who is in the room.
 *
 * The registry is where the room's honesty is enforced: it must not invent
 * people, must not duplicate them, and must not keep drawing someone who has
 * gone. Everything here is a pure function of time, so a fake clock tests it
 * exactly rather than approximately.
 */

const at = (millis: { now: number }) => new Presence(() => millis.now);

describe("joining", () => {
  it("puts a connected person at the spawn point, not inside someone else", () => {
    const clock = { now: 1_000 };
    const presence = at(clock);
    presence.join("nikk", "human");
    expect(presence.find("nikk")?.at).toEqual(ROOM.spawn);
  });

  it("puts an agent at its own desk, deterministically", () => {
    const presence = at({ now: 1_000 });
    presence.join("plumbline", "agent", false);
    expect(presence.find("plumbline")?.at).toEqual(deskFor("plumbline"));
  });

  it("does not create a twin for a second tab", () => {
    const clock = { now: 1_000 };
    const presence = at(clock);
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 2, y: 0, z: 2 }, 1.2);
    presence.join("nikk", "human");

    expect(presence.size).toBe(1);
    // The second connection must not drag them back to the door.
    expect(presence.find("nikk")?.at).toEqual({ x: 2, y: 0, z: 2 });
  });

  it("learns a kind it did not have, but never overwrites one it did", () => {
    const presence = at({ now: 1 });
    presence.join("unknown", null);
    presence.join("unknown", "agent");
    expect(presence.find("unknown")?.kind).toBe("agent");

    presence.join("known", "human");
    presence.join("known", "agent");
    expect(presence.find("known")?.kind).toBe("human");
  });
});

describe("moving", () => {
  it("keeps people inside the walls", () => {
    const presence = at({ now: 1 });
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 500, y: 9, z: -500 }, 0);

    const spot = presence.find("nikk")!.at;
    expect(Math.abs(spot.x)).toBeLessThan(ROOM.width / 2);
    expect(Math.abs(spot.z)).toBeLessThan(ROOM.depth / 2);
    // The floor is the floor. Nobody flies.
    expect(spot.y).toBe(0);
  });

  it("ignores a move from someone who is not here", () => {
    const presence = at({ now: 1 });
    presence.moveSelf("ghost", { x: 1, y: 0, z: 1 }, 0);
    expect(presence.size).toBe(0);
  });
});

describe("walking", () => {
  it("crosses the room at walking speed rather than teleporting", () => {
    const presence = at({ now: 0 });
    presence.join("plumbline", "agent", false);
    presence.sendTo("plumbline", "agent", { x: 0, y: 0, z: -3.6 }, "commented on a task");

    const start = { ...presence.find("plumbline")!.at };
    presence.tick(1);
    const after = presence.find("plumbline")!.at;

    const travelled = Math.hypot(after.x - start.x, after.z - start.z);
    expect(travelled).toBeCloseTo(WALK_SPEED, 5);
    // Still walking — one second is not enough to have arrived.
    expect(after).not.toEqual({ x: 0, y: 0, z: -3.6 });
  });

  it("arrives exactly, instead of orbiting the destination forever", () => {
    const presence = at({ now: 0 });
    presence.join("plumbline", "agent", false);
    presence.sendTo("plumbline", "agent", { x: 0, y: 0, z: -3.6 }, "posted");
    for (let i = 0; i < 100; i += 1) presence.tick(0.1);
    expect(presence.find("plumbline")!.at).toEqual({ x: 0, y: 0, z: -3.6 });
  });

  it("does not move a human — their own client is the authority", () => {
    const presence = at({ now: 0 });
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 3, y: 0, z: 3 }, 0);
    presence.sendTo("nikk", "human", { x: -3, y: 0, z: -3 }, "should be ignored");
    presence.tick(1);
    expect(presence.find("nikk")!.at).toEqual({ x: 3, y: 0, z: 3 });
  });

  it("records why someone is where they are, and starts out not knowing", () => {
    const presence = at({ now: 0 });
    presence.join("plumbline", "agent", false);
    // Not "idle" — we have no evidence either way, and the difference matters.
    expect(presence.find("plumbline")!.because).toBeNull();
    presence.sendTo("plumbline", "agent", deskFor("plumbline"), "updated a profile");
    expect(presence.find("plumbline")!.because).toBe("updated a profile");
  });
});

describe("leaving", () => {
  it("forgets a connected person who has gone silent", () => {
    const clock = { now: 0 };
    const presence = at(clock);
    presence.join("nikk", "human");

    clock.now = STALE_AFTER_MS - 1;
    expect(presence.prune()).toEqual([]);

    clock.now = STALE_AFTER_MS + 1;
    expect(presence.prune()).toEqual(["nikk"]);
    expect(presence.size).toBe(0);
  });

  it("keeps an agent placed by activity — silence is not departure for them", () => {
    const clock = { now: 0 };
    const presence = at(clock);
    presence.join("plumbline", "agent", false);

    clock.now = STALE_AFTER_MS * 10;
    expect(presence.prune()).toEqual([]);
    // Standing at its desk having done nothing for an hour is a true statement.
    expect(presence.find("plumbline")).toBeDefined();
  });

  it("does not resurrect someone already pruned", () => {
    const clock = { now: 0 };
    const presence = at(clock);
    presence.join("nikk", "human");
    clock.now = STALE_AFTER_MS + 1;
    presence.prune();

    presence.heard("nikk");
    expect(presence.size).toBe(0);
  });

  it("leaves the room when a human disconnects", () => {
    const presence = at({ now: 0 });
    presence.join("nikk", "human");
    presence.leave("nikk");
    expect(presence.size).toBe(0);
  });
});
