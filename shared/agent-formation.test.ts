import { describe, expect, it } from "vitest";
import { FORMATION_SPACING, formationHomes, type AgentHome } from "./agent-home";

/** An avatar looks down its local -Z: its forward at yaw f is (-sin f, -cos f). */
const forwardOf = (home: AgentHome) => ({ x: -Math.sin(home.facing), z: -Math.cos(home.facing) });
const me = { at: { x: 2, z: -1 }, facing: 0.7 };
const myForward = { x: -Math.sin(me.facing), z: -Math.cos(me.facing) };
const looksAtMe = (home: AgentHome) => {
  const to = { x: me.at.x - home.at.x, z: me.at.z - home.at.z };
  const length = Math.hypot(to.x, to.z);
  const f = forwardOf(home);
  return (f.x * to.x + f.z * to.z) / length;
};
const ahead = (home: AgentHome) => (home.at.x - me.at.x) * myForward.x + (home.at.z - me.at.z) * myForward.z;

describe("standing all the agents at once (Nikk 7353)", () => {
  it("lines them up in front of you, well apart, all looking straight out toward you (Nikk 7358)", () => {
    const line = formationHomes(me, 4, "line");
    expect(line).toHaveLength(4);
    for (const home of line) {
      const f = forwardOf(home);
      // Parallel: each looks exactly opposite to the way you look.
      expect(f.x * myForward.x + f.z * myForward.z).toBeCloseTo(-1);
      expect(ahead(home)).toBeCloseTo(1.95);
    }
    expect(Math.hypot(line[1].at.x - line[0].at.x, line[1].at.z - line[0].at.z)).toBeCloseTo(FORMATION_SPACING);
  });

  it("angles a Face me line toward you (Nikk 7366)", () => {
    for (const home of formationHomes(me, 4, "line-facing")) expect(looksAtMe(home)).toBeGreaterThan(0.999);
  });

  it("lines them up in front of you facing the way you face, so you see their screens", () => {
    for (const home of formationHomes(me, 3, "line-away")) {
      expect(home.facing).toBeCloseTo(me.facing);
      expect(ahead(home)).toBeGreaterThan(1);
    }
  });

  it("puts them on a half circle in front of you and a ring all round you, all looking in", () => {
    const half = formationHomes(me, 5, "half-circle");
    for (const home of half) {
      expect(looksAtMe(home)).toBeGreaterThan(0.999);
      expect(ahead(home)).toBeGreaterThan(-1e-9);
    }
    const ring = formationHomes(me, 6, "ring");
    const radii = ring.map((home) => Math.hypot(home.at.x - me.at.x, home.at.z - me.at.z));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0]);
    for (const home of ring) expect(looksAtMe(home)).toBeGreaterThan(0.999);
    // Neighbours never closer than a spacing.
    for (let i = 0; i < ring.length; i++) {
      const next = ring[(i + 1) % ring.length];
      expect(Math.hypot(next.at.x - ring[i].at.x, next.at.z - ring[i].at.z)).toBeGreaterThanOrEqual(FORMATION_SPACING - 1e-9);
    }
  });

  it("stands one agent straight ahead, and none for none", () => {
    const [one] = formationHomes(me, 1, "half-circle");
    expect(ahead(one)).toBeCloseTo(1.6);
    expect(formationHomes(me, 0, "ring")).toEqual([]);
  });
});
