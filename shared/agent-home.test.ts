import { describe, expect, it } from "vitest";
import {
  BESIDE_DISTANCE,
  IN_FRONT_DISTANCE,
  facingToward,
  homeBesideMe,
  homeFacingMe,
  resolveFacing,
} from "./agent-home";
import { AGENT_SCREEN, agentScreenPose } from "./screens";

/** The room's rule: an avatar facing f looks along (-sin f, 0, -cos f). */
const looks = (facing: number) => ({ x: -Math.sin(facing), z: -Math.cos(facing) });
const dot = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x * b.x + a.z * b.z;

describe("where people ask agents to stand", () => {
  const me = { at: { x: 1, z: 2 }, facing: 0.7 };

  it("'here, facing me' puts the agent in front of me, looking at me", () => {
    // Nikk: "I want you to be standing over here facing me".
    const home = homeFacingMe(me);
    const toAgent = { x: home.at.x - me.at.x, z: home.at.z - me.at.z };
    expect(Math.hypot(toAgent.x, toAgent.z)).toBeCloseTo(IN_FRONT_DISTANCE, 9);
    expect(dot(toAgent, looks(me.facing)), "in front of me").toBeGreaterThan(0);
    const toMe = { x: me.at.x - home.at.x, z: me.at.z - home.at.z };
    expect(dot(looks(home.facing), toMe) / Math.hypot(toMe.x, toMe.z), "looking straight at me").toBeCloseTo(1, 9);
  });

  it("'beside me, facing away so I can watch' puts the agent at my side, facing where I face", () => {
    // Nikk: "standing beside me facing away from me so I can watch your work".
    const home = homeBesideMe(me);
    expect(home.facing).toBeCloseTo(me.facing, 9);
    const right = { x: Math.cos(me.facing), z: -Math.sin(me.facing) };
    const toAgent = { x: home.at.x - me.at.x, z: home.at.z - me.at.z };
    expect(dot(toAgent, right)).toBeCloseTo(BESIDE_DISTANCE, 9);
    expect(homeBesideMe(me, "left").at.x).not.toBeCloseTo(home.at.x, 3);
  });

  it("which puts the agent's screen in front of me, where I can read it", () => {
    const home = homeBesideMe(me);
    const screen = agentScreenPose(home.at, home.facing).position;
    const toScreen = { x: screen.x - me.at.x, z: screen.z - me.at.z };
    expect(dot(toScreen, looks(me.facing))).toBeGreaterThan(AGENT_SCREEN.ahead);
  });
});

/**
 * FACING SOMEBODY BY NAME.
 *
 * clem, in a headset, to Waffle: "when I tell you to go to someone, you do the
 * right thing within the face the wrong direction. You have to rotate by 180
 * degrees." Waffle had derived the angle the intuitive way round and had no way
 * to see the result. These tests assert the thing a person in the room can see
 * — that the avatar's forward vector points AT the other body — rather than
 * re-stating the formula, which is how a sign error passes its own test.
 */
describe("facing somebody by name", () => {
  const room = { Nikk2: { x: 3, z: -1 }, clem: { x: -2, z: 2 } };
  const whereIs = (name: string) => (room as Record<string, { x: number; z: number }>)[name] ?? null;
  const whoIsHere = () => Object.keys(room).sort();

  /** How much of the way the avatar is looking lies toward the target: 1 is dead on, -1 is its back. */
  const towards = (standing: { x: number; z: number }, facing: number, target: { x: number; z: number }) => {
    const to = { x: target.x - standing.x, z: target.z - standing.z };
    return dot(looks(facing), to) / Math.hypot(to.x, to.z);
  };

  it("points the avatar at the person, not away from them", () => {
    const standing = { x: 0, z: 0 };
    const asked = resolveFacing({ face: "Nikk2" }, standing, whereIs, whoIsHere);
    expect("facing" in asked).toBe(true);
    if (!("facing" in asked)) return;
    // THE REGRESSION. Get the subtraction backwards and this is -1: dead on,
    // in precisely the wrong direction.
    expect(towards(standing, asked.facing, room.Nikk2), "looking straight at them").toBeCloseTo(1, 9);
  });

  it("is right from every side of the room, not just the one that was tried", () => {
    // A single spot can pass with a flipped sign if it happens to be symmetric.
    for (const standing of [{ x: 0, z: 0 }, { x: 5, z: 5 }, { x: -4, z: 3 }, { x: 3, z: -6 }, { x: -1, z: -1 }]) {
      const asked = resolveFacing({ face: "clem" }, standing, whereIs, whoIsHere);
      if (!("facing" in asked)) throw new Error("expected an angle");
      expect(towards(standing, asked.facing, room.clem)).toBeCloseTo(1, 9);
    }
  });

  it("agrees exactly with the formula the server turns walking agents with", () => {
    // One copy of the sign convention, so the home route and the settle loop
    // cannot drift apart and leave an agent facing two ways in one room.
    const standing = { x: 1, z: 4 };
    const asked = resolveFacing({ face: "Nikk2" }, standing, whereIs, whoIsHere);
    if (!("facing" in asked)) throw new Error("expected an angle");
    expect(asked.facing).toBeCloseTo(facingToward(standing, room.Nikk2), 12);
  });

  it("still takes a plain angle, for anyone who has one", () => {
    expect(resolveFacing({ facing: 1.2 }, { x: 0, z: 0 }, whereIs, whoIsHere)).toEqual({ facing: 1.2 });
    // Zero is a real angle, and a falsy one: it must not be read as "unset".
    expect(resolveFacing({ facing: 0 }, { x: 0, z: 0 }, whereIs, whoIsHere)).toEqual({ facing: 0 });
  });

  it("names who IS in the room when the name is wrong", () => {
    // An agent cannot look around to find out how somebody spells themselves,
    // so a refusal that only says "no" leaves it guessing.
    const asked = resolveFacing({ face: "Nikki" }, { x: 0, z: 0 }, whereIs, whoIsHere);
    expect("error" in asked && asked.error).toContain("Nikk2");
    expect("error" in asked && asked.error).toContain("clem");
  });

  it("refuses an angle and a name together rather than quietly picking one", () => {
    const asked = resolveFacing({ facing: 0.4, face: "clem" }, { x: 0, z: 0 }, whereIs, whoIsHere);
    expect("error" in asked && asked.error).toMatch(/not both/);
  });

  it("refuses to invent a direction toward somebody you are standing on", () => {
    // atan2(0, 0) is 0: a confident answer that means nothing at all.
    const asked = resolveFacing({ face: "clem" }, { x: -2, z: 2 }, whereIs, whoIsHere);
    expect("error" in asked && asked.error).toMatch(/no way to face/);
  });

  it("asks for one of the two when given neither", () => {
    for (const body of [{}, { facing: "sideways" }, { facing: Number.NaN }, { face: "  " }]) {
      const asked = resolveFacing(body, { x: 0, z: 0 }, whereIs, whoIsHere);
      expect("error" in asked, `${JSON.stringify(body)} is not a facing`).toBe(true);
    }
  });
});

/**
 * NOBODY FACES THEMSELVES.
 *
 * Found by tools/onboarding-audit.mts against the live site, not by any test
 * here: asking to be placed somewhere new facing your OWN name returned 200
 * and a real angle, pointing back at the spot you were leaving. Two different
 * points, so the same-spot guard never fired — it checks geometry, and this is
 * a question about identity.
 */
describe("resolveFacing, asked to face the person being placed", () => {
  const somewhere = { x: 0.9, y: 0, z: 6.5 };
  const whereIs = (actorId: string) => (actorId.toLowerCase() === "sill" ? somewhere : null);
  const whoIsHere = () => ["Corvid", "Sill"];

  it("refuses, even from a spot that is nowhere near them", () => {
    const asked = resolveFacing({ face: "Sill" }, { x: 1.4, y: 0, z: 5.2 }, whereIs, whoIsHere, "Sill");
    expect(asked).toEqual({ error: "Sill cannot face Sill; name somebody else, or give an angle" });
  });

  it("refuses however the two systems spell the name", () => {
    // The room says `sill` where the chat says `Sill`, and a case-sensitive
    // check here would let exactly half of these through.
    for (const [named, placing] of [["sill", "Sill"], ["SILL", "sill"], [" Sill ", "Sill"]]) {
      expect(resolveFacing({ face: named }, { x: 1.4, y: 0, z: 5.2 }, whereIs, whoIsHere, placing), named).toHaveProperty(
        "error",
      );
    }
  });

  it("still answers when somebody ELSE is named", () => {
    const withCorvid = (actorId: string) => (actorId.toLowerCase() === "corvid" ? somewhere : null);
    const asked = resolveFacing({ face: "Corvid" }, { x: 1.4, y: 0, z: 5.2 }, withCorvid, whoIsHere, "Sill");
    expect(asked).toHaveProperty("facing");
  });

  it("is unchanged for every caller that does not say who is being placed", () => {
    // The parameter is optional so existing callers keep working; without it
    // the old geometric guard is all there is, which is what they had.
    const asked = resolveFacing({ face: "Sill" }, { x: 1.4, y: 0, z: 5.2 }, whereIs, whoIsHere);
    expect(asked).toHaveProperty("facing");
  });
});
