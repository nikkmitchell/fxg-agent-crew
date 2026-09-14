import { describe, expect, it } from "vitest";
import { facingToward, Presence, STALE_AFTER_MS } from "../space/presence.js";
import { ROOM, WALK_SPEED, deskFor } from "../../shared/space-layout.js";
import { AMBIENT_PAUSE_MIN_MS, CONVERSATION_FAR } from "../space/social-motion.js";

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

  it("clears the reason when someone walks themselves somewhere", () => {
    const presence = at({ now: 0 });
    presence.sendTo("nikk", "human", { x: -3, y: 0, z: -3 }, "wrote a new card");
    presence.join("nikk", "human", true);
    presence.moveSelf("nikk", { x: 1, y: 0, z: 1 }, 0);
    // "Why are they standing here" is now "they walked there". Keeping the old
    // answer put a board action under someone standing somewhere else.
    expect(presence.find("nikk")?.because).toBeNull();
  });

  it("ignores a move from someone who is not here", () => {
    const presence = at({ now: 1 });
    presence.moveSelf("ghost", { x: 1, y: 0, z: 1 }, 0);
    expect(presence.size).toBe(0);
  });

  it("keeps a self-reported facing to one readable turn", () => {
    const presence = at({ now: 1 });
    presence.join("baiwei", "human");

    presence.moveSelf("baiwei", { x: 1, y: 0, z: 1 }, -Math.PI * 1.5);

    expect(presence.find("baiwei")?.facing).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe("walking", () => {
  it("computes yaw for the avatar's -Z forward axis", () => {
    const yaw = facingToward({ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
    const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    expect(forward.x).toBeCloseTo(1, 6);
    expect(forward.z).toBeCloseTo(0, 6);
  });

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

  it("faces the direction of travel and then the surface on arrival", () => {
    const presence = at({ now: 0 });
    presence.join("plumbline", "agent", false);
    const start = { ...presence.find("plumbline")!.at };
    const destination = { x: start.x + 2, y: 0, z: start.z };
    presence.sendTo("plumbline", "agent", destination, "checking tasks", -0.75);

    presence.tick(0.1);
    expect(presence.find("plumbline")!.facing).toBeCloseTo(
      facingToward(start, destination),
      6,
    );
    for (let i = 0; i < 30; i += 1) presence.tick(0.1);
    expect(presence.find("plumbline")!.at).toEqual(destination);
    expect(presence.find("plumbline")!.facing).toBeCloseTo(-0.75, 6);
  });

  it("keeps a speaker turned toward a moving addressee while the line is live", () => {
    const clock = { now: 1_000 };
    const presence = at(clock);
    presence.join("Inkstone", "agent", false);
    presence.join("Nikk", "human", true);
    presence.moveSelf("Nikk", { x: 2, y: 0, z: 2 }, 0);
    presence.speakTo("Inkstone", "agent", "Nikk", 6_000);
    presence.tick(0.1);

    const inkstone = presence.find("Inkstone")!;
    expect(inkstone.facing).toBeCloseTo(facingToward(inkstone.at, { x: 2, y: 0, z: 2 }), 6);

    presence.moveSelf("Nikk", { x: -2, y: 0, z: 1 }, 0);
    presence.tick(0.1);
    expect(inkstone.facing).toBeCloseTo(facingToward(inkstone.at, { x: -2, y: 0, z: 1 }), 6);

    clock.now += 6_001;
    presence.tick(0.1);
    expect(inkstone.speakingTo).toBeNull();
    expect(inkstone.because).toBeNull();
  });

  it("walks an agent close enough to have an addressed conversation", () => {
    const clock = { now: 1_000 };
    const presence = at(clock);
    const agent = presence.join("Inkstone", "agent", false);
    presence.join("Nikk", "human", true);
    presence.moveSelf("Nikk", { x: -4, y: 0, z: -4 }, 0);
    const before = Math.hypot(agent.at.x + 4, agent.at.z + 4);

    presence.speakTo("Inkstone", "agent", "Nikk", 14_000);
    for (let step = 0; step < 120; step += 1) {
      clock.now += 100;
      presence.tick(0.1);
    }

    const after = Math.hypot(agent.at.x + 4, agent.at.z + 4);
    expect(after).toBeLessThan(before);
    expect(after).toBeLessThanOrEqual(CONVERSATION_FAR);
    expect(agent.because).toBe("talking with Nikk");
  });

  it("follows the addressee instead of talking toward where they used to be", () => {
    const clock = { now: 1_000 };
    const presence = at(clock);
    const agent = presence.join("Inkstone", "agent", false);
    presence.join("Nikk", "human", true);
    presence.moveSelf("Nikk", { x: -4, y: 0, z: -4 }, 0);
    presence.speakTo("Inkstone", "agent", "Nikk", 14_000);
    presence.tick(0.1);
    const firstHeading = { ...agent.heading };

    presence.moveSelf("Nikk", { x: 4, y: 0, z: -4 }, 0);
    clock.now += 100;
    presence.tick(0.1);
    expect(agent.heading).not.toEqual(firstHeading);
  });

  it("does not move a human — their own client is the authority", () => {
    const presence = at({ now: 0 });
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 3, y: 0, z: 3 }, 0);
    presence.sendTo("nikk", "human", { x: -3, y: 0, z: -3 }, "should be ignored");
    presence.tick(1);
    expect(presence.find("nikk")!.at).toEqual({ x: 3, y: 0, z: 3 });
  });

  it("will not move or relabel someone who is driving their own avatar", () => {
    const presence = at({ now: 0 });
    presence.join("nikk", "human");
    presence.moveSelf("nikk", { x: 3, y: 0, z: 3 }, 0.4);
    presence.sendTo("nikk", "human", { x: -3, y: 0, z: -3 }, "wrote a new card");

    const nikk = presence.find("nikk")!;
    expect(nikk.heading).toEqual({ x: 3, y: 0, z: 3 });
    // `because` means "why they are HERE". The room once read "nikk — wrote a
    // new card" while nikk stood at the door: two true facts arranged into a
    // false sentence.
    expect(nikk.because).toBeNull();
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

/**
 * Whose body the server may turn.
 *
 * The rule is the same one that governs hands: a fact a device tells us is not
 * ours to overwrite with one we worked out. An agent has no device, which is
 * exactly why it may be walked and turned; a person wearing a headset is
 * measuring their own facing ninety times a second and sending it.
 *
 * Found while merging the locomotion work: the turn-to-speak ran for everybody,
 * connected or not, so a person in a headset would have had the server and
 * their own device each insisting on a different facing several times a second.
 */
describe("turning a speaker toward the person they address", () => {
  const room = () => new Presence(() => 1_000);

  it("turns an agent, which has no device to tell us otherwise", () => {
    const presence = room();
    presence.join("agent-one", "agent", false);
    presence.join("listener", "human", false);
    presence.moveSelf("listener", { x: 4, y: 0, z: 0 }, 0);
    const before = presence.find("agent-one")?.facing;

    presence.speakTo("agent-one", "agent", "listener", 5_000);
    expect(presence.find("agent-one")?.facing).not.toBe(before);
  });

  it("NEVER turns a connected person — their own headset is the authority", () => {
    const presence = room();
    presence.join("nikk", "human", true);
    presence.join("baiwei", "human", true);
    presence.moveSelf("nikk", { x: 0, y: 0, z: 0 }, 1.23);
    presence.moveSelf("baiwei", { x: 4, y: 0, z: 4 }, 0);

    presence.speakTo("nikk", "human", "baiwei", 5_000);
    expect(presence.find("nikk")?.facing).toBe(1.23);

    // And not on the next tick either, which is where it would have shown up
    // as a body snapping back and forth rather than as one wrong frame.
    presence.tick(0.1);
    expect(presence.find("nikk")?.facing).toBe(1.23);
  });

  it("leaves a connected person's position alone while they speak", () => {
    const presence = room();
    presence.join("nikk", "human", true);
    presence.join("baiwei", "human", false);
    presence.moveSelf("nikk", { x: 1, y: 0, z: 2 }, 0.5);
    presence.speakTo("nikk", "human", "baiwei", 5_000);
    presence.tick(1);
    expect(presence.find("nikk")?.at).toEqual({ x: 1, y: 0, z: 2 });
  });
});

/**
 * What an agent is doing with itself.
 *
 * The room infers it rather than waiting to be told, because an agent that
 * forgot to say would stand frozen — which is the state this is meant to end.
 * Nikk: "if you're working you can just put on a thinking animation... or I
 * even better, a meditation animation."
 */
describe("posture", () => {
  const room = (clock: () => number) => new Presence(clock);

  it("settles an agent that has done nothing into sleeping", () => {
    const presence = room(() => 10 * 60_000);
    presence.join("plumbline", "agent", false);
    presence.tick(0.1);
    expect(presence.find("plumbline")?.avatar.posture).toBe("sleeping");
  });

  it("an agent that just acted is thinking", () => {
    const presence = room(() => 10 * 60_000);
    presence.sendTo("plumbline", "agent", { x: 1, y: 0, z: 1 }, "commented on a card");
    presence.tick(0.1);
    expect(presence.find("plumbline")?.avatar.posture).toBe("thinking");
  });

  it("goes back to rest once the work is old", () => {
    let now = 10 * 60_000;
    const presence = room(() => now);
    presence.sendTo("plumbline", "agent", { x: 1, y: 0, z: 1 }, "commented on a card");
    presence.tick(0.1);
    expect(presence.find("plumbline")?.avatar.posture).toBe("thinking");

    now += 6 * 60_000;
    presence.tick(0.1);
    expect(presence.find("plumbline")?.avatar.posture).toBe("sleeping");
  });

  it("NEVER gives a human a posture — they have a body of their own", () => {
    const presence = room(() => 10 * 60_000);
    presence.join("nikk", "human", true);
    presence.tick(0.1);
    expect(presence.find("nikk")?.avatar.posture).toBe("resting");
  });

  it("an agent that names its own posture keeps it", () => {
    // Some know they are about to be busy before the audit trail does.
    const presence = room(() => 10 * 60_000);
    presence.join("plumbline", "agent", false);
    presence.animate("plumbline", { posture: "thinking" }, "agent");
    presence.tick(0.1);
    expect(presence.find("plumbline")?.avatar.posture).toBe("thinking");
  });

  it("but acting takes it back, because the audit trail is the better witness", () => {
    const presence = room(() => 10 * 60_000);
    presence.animate("plumbline", { posture: "sleeping" }, "agent");
    presence.sendTo("plumbline", "agent", { x: 1, y: 0, z: 1 }, "wrote a card");
    presence.tick(0.1);
    expect(presence.find("plumbline")?.avatar.posture).toBe("thinking");
  });
});

describe("ambient movement", () => {
  it("gives an unoccupied agent an occasional local walk without inventing a reason", () => {
    const clock = { now: 0 };
    const presence = at(clock);
    const agent = presence.join("Plumbline", "agent", false);
    const home = { ...agent.at };

    presence.tick(0.1);
    clock.now = AMBIENT_PAUSE_MIN_MS + 22_001;
    presence.tick(0.1);

    expect(agent.heading).not.toEqual(home);
    expect(agent.because).toBeNull();
  });

  it("never lets ambience pull an agent away from purposeful work", () => {
    const clock = { now: 0 };
    const presence = at(clock);
    const destination = { x: -2, y: 0, z: -3 };
    const agent = presence.join("Plumbline", "agent", false);
    presence.sendTo("Plumbline", "agent", destination, "checking tasks");

    clock.now = AMBIENT_PAUSE_MIN_MS + 22_001;
    presence.tick(0.1);
    expect(agent.heading).toEqual(destination);
    expect(agent.because).toBe("checking tasks");
  });
});

/**
 * Who the room moves.
 *
 * `connected` used to stand in for "moves itself", which is true of a person in
 * a headset and false of an agent whether or not it holds a socket open. An
 * agent that opened one to watch the room silently stopped being walked.
 */
describe("who the room moves", () => {
  it("walks an agent even while it is connected", () => {
    const presence = new Presence(() => 1_000);
    presence.join("plumbline", "agent", true);
    presence.sendTo("plumbline", "agent", { x: 3, y: 0, z: 3 }, "wrote a card");
    presence.tick(1);
    const at = presence.find("plumbline")?.at;
    expect(at?.x).toBeGreaterThan(0);
  });

  it("never walks a connected human", () => {
    const presence = new Presence(() => 1_000);
    presence.join("nikk", "human", true);
    presence.moveSelf("nikk", { x: 1, y: 0, z: 1 }, 0);
    presence.sendTo("nikk", "human", { x: 5, y: 0, z: 5 }, "wrote a card");
    presence.tick(1);
    expect(presence.find("nikk")?.at).toEqual({ x: 1, y: 0, z: 1 });
  });

  it("an agent starts at its desk, not on the doorstep", () => {
    const presence = new Presence(() => 1_000);
    const spawnish = presence.join("plumbline", "agent", true).at;
    expect(`${spawnish.x},${spawnish.z}`).not.toBe("0,6.2");
  });
});

/**
 * Who stays when a connection drops.
 *
 * The bug: an agent that opened a socket to WATCH the room was deleted from it
 * the moment that socket closed. Nikk and Baiwei both looked for Plumbline in
 * the live room and saw nobody, while a local room — where it had never
 * connected — showed it perfectly. Looking cost it its presence.
 */
describe("leaving", () => {
  it("AN AGENT STAYS when its socket closes", () => {
    const presence = new Presence(() => 1_000);
    presence.join("plumbline", "agent", true);
    presence.leave("plumbline");
    expect(presence.find("plumbline")).toBeDefined();
  });

  it("and is marked disconnected rather than absent", () => {
    // The room draws a disconnected figure differently — a broken ring. That
    // is a true and useful thing to say; deleting it says something false.
    const presence = new Presence(() => 1_000);
    presence.join("plumbline", "agent", true);
    presence.leave("plumbline");
    expect(presence.find("plumbline")?.connected).toBe(false);
  });

  it("keeps where the agent was standing", () => {
    const presence = new Presence(() => 1_000);
    presence.join("plumbline", "agent", true);
    presence.sendTo("plumbline", "agent", { x: 2, y: 0, z: 2 }, "wrote a card");
    presence.tick(5);
    const before = { ...(presence.find("plumbline")?.at ?? { x: 0, y: 0, z: 0 }) };
    presence.leave("plumbline");
    expect(presence.find("plumbline")?.at).toEqual(before);
  });

  it("a person who disconnects does leave", () => {
    // A headset that goes dark means we no longer know where that person is,
    // and saying they are still standing there would be an invention.
    const presence = new Presence(() => 1_000);
    presence.join("nikk", "human", true);
    presence.leave("nikk");
    expect(presence.find("nikk")).toBeUndefined();
  });

  it("a disconnected agent survives pruning", () => {
    let now = 1_000;
    const presence = new Presence(() => now);
    presence.join("plumbline", "agent", true);
    presence.leave("plumbline");
    now += 10 * 60_000;
    expect(presence.prune()).not.toContain("plumbline");
    expect(presence.find("plumbline")).toBeDefined();
  });
});
