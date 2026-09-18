import { describe, expect, it } from "vitest";
import { Presence } from "../space/presence.js";
import { WALK_BESIDE } from "../../shared/walk-beside.js";
import { WALK_SPEED } from "../../shared/space-layout.js";

/**
 * Walking with somebody.
 *
 * Nikk asked to walk down a street in AR with an agent beside them; Waffle had
 * already asked for it from inside the room, having built it from a timer and
 * found that it chased. So the two things worth asserting are not "does the
 * endpoint return 200" but: does the follower END UP beside a person who keeps
 * moving, and does it stay sane when that person jumps.
 *
 * The clock is fake and every step is a whole number of ticks, so these are
 * exact rather than approximate.
 */

const TICK = 0.1;
const gap = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** A room with a person and an agent following them. */
const walking = () => {
  const clock = { now: 1_000 };
  const presence = new Presence(() => clock.now);
  presence.join("Nikk2", "human");
  presence.join("Nightjar", "agent", false);
  const step = (seconds = TICK) => {
    clock.now += seconds * 1000;
    presence.tick(seconds);
  };
  return { clock, presence, step };
};

describe("starting and stopping", () => {
  it("walks beside the person named, on a side it reports", () => {
    const { presence } = walking();
    const result = presence.follow("Nightjar", "agent", "Nikk2", "left", null);
    expect(result).toEqual({ ok: true, side: "left" });
    expect(presence.find("Nightjar")?.following?.actorId).toBe("Nikk2");
  });

  it("says why it is there, so the room is not left guessing", () => {
    const { presence } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", null, null);
    expect(presence.find("Nightjar")?.because).toBe("walking with Nikk2");
  });

  it("keeps a reason the caller gave instead of inventing one", () => {
    const { presence } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", null, "you asked me to come along");
    expect(presence.find("Nightjar")?.because).toBe("you asked me to come along");
  });

  it("refuses to follow yourself", () => {
    const { presence } = walking();
    expect(presence.follow("Nightjar", "agent", "Nightjar", null, null))
      .toMatchObject({ ok: false, code: "CANNOT_FOLLOW_YOURSELF" });
  });

  it("refuses somebody who is not in the room, rather than waiting for them", () => {
    const { presence } = walking();
    expect(presence.follow("Nightjar", "agent", "Waffle", null, null))
      .toMatchObject({ ok: false, code: "NOT_IN_THE_ROOM" });
  });

  /**
   * A PERSON'S DEVICE OWNS THEIR POSITION. The same rule that stops the server
   * turning a connected headset also stops it walking one.
   */
  it("refuses to walk somebody who moves themselves", () => {
    const { presence } = walking();
    expect(presence.follow("Nikk2", "human", "Nightjar", null, null))
      .toMatchObject({ ok: false, code: "YOU_MOVE_YOURSELF" });
  });

  it("refuses a pair that would follow each other into nowhere", () => {
    const { presence } = walking();
    presence.join("Sill", "agent", false);
    expect(presence.follow("Sill", "agent", "Nightjar", null, null)).toMatchObject({ ok: true });
    const refused = presence.follow("Nightjar", "agent", "Sill", null, null);
    expect(refused).toMatchObject({ ok: false, code: "THAT_WOULD_BE_A_RING" });
    expect("error" in refused && refused.error).toContain("already following you");
  });

  /**
   * A RING OF ANY LENGTH, not just a pair. Checking only "does the target
   * follow me" accepted Ash->Birch, Birch->Cedar, Cedar->Ash, and Sill measured
   * the three converging to 0.14m apart and standing inside one another —
   * exactly what roomFor exists to prevent, arrived at by three legal moves.
   */
  it("refuses to close a ring of three", () => {
    const { presence } = walking();
    presence.join("Ash", "agent", false);
    presence.join("Birch", "agent", false);
    presence.join("Cedar", "agent", false);

    expect(presence.follow("Ash", "agent", "Birch", null, null)).toMatchObject({ ok: true });
    expect(presence.follow("Birch", "agent", "Cedar", null, null)).toMatchObject({ ok: true });
    const closing = presence.follow("Cedar", "agent", "Ash", null, null);
    expect(closing).toMatchObject({ ok: false, code: "THAT_WOULD_BE_A_RING" });
    expect("error" in closing && closing.error).toContain("Ash");
    expect(presence.find("Cedar")!.following).toBeNull();
  });

  it("still allows a chain that does not close", () => {
    const { presence } = walking();
    presence.join("Ash", "agent", false);
    presence.join("Birch", "agent", false);
    expect(presence.follow("Ash", "agent", "Birch", null, null)).toMatchObject({ ok: true });
    expect(presence.follow("Birch", "agent", "Nikk2", null, null)).toMatchObject({ ok: true });
  });

  it("stops, and says who it stopped following", () => {
    const { presence } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", null, null);
    expect(presence.stopFollowing("Nightjar")).toEqual({ was: "Nikk2" });
    expect(presence.find("Nightjar")?.following).toBeNull();
    expect(presence.find("Nightjar")?.because).toBe("stopped walking with Nikk2");
  });

  it("is safe to stop when not following, so a retry cannot fail", () => {
    const { presence } = walking();
    expect(presence.stopFollowing("Nightjar")).toEqual({ was: null });
  });

  it("lists who is walking with a person", () => {
    const { presence } = walking();
    presence.join("Sill", "agent", false);
    presence.follow("Nightjar", "agent", "Nikk2", null, null);
    presence.follow("Sill", "agent", "Nikk2", null, null);
    expect(presence.followers("Nikk2").sort()).toEqual(["Nightjar", "Sill"]);
  });

  it("puts two followers of one person on different shoulders", () => {
    const { presence } = walking();
    presence.join("Sill", "agent", false);
    presence.follow("Nightjar", "agent", "Nikk2", null, null);
    presence.follow("Sill", "agent", "Nikk2", null, null);
    expect(presence.find("Nightjar")!.following!.side)
      .not.toBe(presence.find("Sill")!.following!.side);
  });
});

describe("a person placing an agent", () => {
  /**
   * AN EXPLICIT PLACEMENT OUTRANKS A STANDING INSTRUCTION. Before this, the
   * placement was applied and then silently undone on the next tick by the
   * follow rewriting the heading: Sill reproduced an agent placed at (-8,-8)
   * that was still beside its target fifteen seconds later.
   */
  it("ends a follow, and says whose it ended", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);
    step();

    const sent = presence.sendTo("Nightjar", "agent", { x: -8, y: 0, z: -8 }, "placed by Nikk2", null, true);
    expect(sent).toMatchObject({ moved: true, stoppedFollowing: "Nikk2" });

    for (let tick = 0; tick < 150; tick += 1) step();
    expect(presence.find("Nightjar")!.following).toBeNull();
    expect(gap(presence.find("Nightjar")!.at, { x: -8, z: -8 })).toBeLessThan(0.3);
  });

  it("ends a route, and says how much of it was left", () => {
    const { presence, step } = walking();
    presence.walk("Nightjar", "agent", [{ x: 5, y: 0, z: 5 }, { x: 6, y: 0, z: 6 }], null);
    step();
    expect(presence.sendTo("Nightjar", "agent", { x: -8, y: 0, z: -8 }, null, null, true))
      .toMatchObject({ moved: true, abandonedRoute: 2 });
    expect(presence.find("Nightjar")!.walking).toBeNull();
  });

  /**
   * AN AUTOMATIC SEND IS DECLINED INSTEAD. activity.ts walks agents to the board
   * through the same call, and a board comment should not drag somebody out of
   * walking with a person. Declining says so; applying-and-reverting did not.
   */
  it("does not let an automatic send interrupt a follow", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);
    step();

    const sent = presence.sendTo("Nightjar", "agent", { x: -8, y: 0, z: -8 }, "commented on a card");
    expect(sent).toEqual({ moved: false, stoppedFollowing: null, abandonedRoute: 0 });
    expect(presence.find("Nightjar")!.following?.actorId).toBe("Nikk2");

    for (let tick = 0; tick < 40; tick += 1) step();
    expect(gap(presence.find("Nightjar")!.at, presence.find("Nikk2")!.at)).toBeLessThan(1.4);
  });

  it("still sends somebody who has no standing instruction", () => {
    const { presence, step } = walking();
    expect(presence.sendTo("Nightjar", "agent", { x: -8, y: 0, z: -8 }, "commented on a card"))
      .toMatchObject({ moved: true });
    for (let tick = 0; tick < 150; tick += 1) step();
    expect(gap(presence.find("Nightjar")!.at, { x: -8, z: -8 })).toBeLessThan(0.3);
  });
});

describe("actually walking together", () => {
  /**
   * THE WHOLE POINT, and the number it converges to.
   *
   * A follower walks at WALK_SPEED and closes on a walking person at the
   * DIFFERENCE of their speeds — 0.2 m/s against an ordinary 1.2 m/s pace — so
   * "beside" is reached after several seconds of walking, not immediately. What
   * must be true is that the distance keeps shrinking and settles at the
   * shoulder, which is what a re-sent home could not do.
   */
  it("closes on somebody who keeps moving, and ends up at their shoulder", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);

    const startX = presence.find("Nikk2")!.at.x;
    let z = presence.find("Nikk2")!.at.z;
    const walkOn = (ticks: number) => {
      for (let tick = 0; tick < ticks; tick += 1) {
        z -= 1.2 * TICK;                     // an ordinary walking pace
        presence.moveSelf("Nikk2", { x: startX, y: 0, z }, 0);
        step();
      }
      return gap(presence.find("Nightjar")!.at, presence.find("Nikk2")!.at);
    };

    const afterASecond = walkOn(10);
    const afterFive = walkOn(40);
    const afterFifteen = walkOn(100);

    expect(afterFive).toBeLessThan(afterASecond);
    expect(afterFifteen).toBeLessThan(afterFive);
    // The shoulder: one sideways gap and a quarter-step back.
    expect(afterFifteen).toBeLessThan(WALK_BESIDE.gap + WALK_BESIDE.behind + 0.2);
  });

  /**
   * AN HONEST LIMIT, WRITTEN DOWN. WALK_SPEED is 1.4 m/s, so a person who runs
   * cannot be kept up with — and the right behaviour is to fall behind rather
   * than to cheat, because a follower that keeps pace with a sprinter is
   * teleporting and the room's rule is that movement means something.
   */
  it("falls behind a person who outruns it instead of cheating", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);

    const startX = presence.find("Nikk2")!.at.x;
    let z = presence.find("Nikk2")!.at.z;
    let previous = gap(presence.find("Nightjar")!.at, presence.find("Nikk2")!.at);
    for (let tick = 0; tick < 40; tick += 1) {
      z -= 3.5 * TICK;                       // faster than WALK_SPEED
      presence.moveSelf("Nikk2", { x: startX, y: 0, z }, 0);
      step();
      const now = gap(presence.find("Nightjar")!.at, presence.find("Nikk2")!.at);
      // Never a jump: each tick moves the follower at most one stride.
      expect(now).toBeGreaterThan(previous - WALK_SPEED * TICK - 1e-9);
      previous = now;
    }
    expect(previous).toBeGreaterThan(WALK_BESIDE.gap);
  });

  it("does not stand inside the person it is walking with", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);
    for (let tick = 0; tick < 40; tick += 1) step();
    expect(gap(presence.find("Nightjar")!.at, presence.find("Nikk2")!.at)).toBeGreaterThan(0.4);
  });

  /**
   * WAFFLE'S MEASUREMENT. A person who teleports must not be led: the follower
   * should head for beside the NEW position, and never be thrown past it by a
   * velocity that was really a jump.
   */
  it("does not get thrown across the room when the person teleports", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);
    step();

    presence.moveSelf("Nikk2", { x: 12, y: 0, z: -18 }, 0);
    step();

    const heading = presence.find("Nightjar")!.heading;
    // Beside the new position, within a stride of it — not flung beyond.
    expect(gap(heading, { x: 12, z: -18 })).toBeLessThan(1.6);
  });

  it("settles beside a person who stops, rather than circling them", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "right", null);
    for (let tick = 0; tick < 60; tick += 1) step();

    const first = { ...presence.find("Nightjar")!.at };
    for (let tick = 0; tick < 20; tick += 1) step();
    expect(gap(first, presence.find("Nightjar")!.at)).toBeLessThan(0.05);
  });

  /**
   * A FOLLOW THAT CANNOT BE HONOURED ENDS ITSELF, and says so. Standing still
   * with a stale intention renders as idling, which is the room claiming
   * something it cannot account for.
   */
  it("stops following somebody who leaves, and says that is why", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", null, null);
    step();

    presence.leave("Nikk2");
    step();

    expect(presence.find("Nightjar")?.following).toBeNull();
    expect(presence.find("Nightjar")?.because).toBe("stopped following Nikk2, who is not in the room");
  });

  it("never walks faster than anybody else in the room", () => {
    const { presence, step } = walking();
    presence.follow("Nightjar", "agent", "Nikk2", "left", null);
    const before = { ...presence.find("Nightjar")!.at };
    presence.moveSelf("Nikk2", { x: 3, y: 0, z: -3 }, 0);
    step();
    expect(gap(before, presence.find("Nightjar")!.at)).toBeLessThanOrEqual(WALK_SPEED * TICK + 1e-9);
  });
});
