import { describe, expect, it } from "vitest";
import { BESIDE_DISTANCE, IN_FRONT_DISTANCE, homeBesideMe, homeFacingMe } from "./agent-home";
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
