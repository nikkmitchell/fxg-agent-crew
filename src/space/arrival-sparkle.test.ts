import { describe, expect, it } from "vitest";
import { SPARKLE_LIFE_S, arrivals, burstVelocities, sparkleOpacity, stepSparkles } from "./arrival-sparkle";

const agent = (over: Record<string, unknown> = {}) => ({ actorId: "Sill", kind: "agent", moving: false, because: "moved a card", ...over });

describe("a burst where an agent reaches a board", () => {
  it("fires once, on the frame the agent stops at the board", () => {
    const seen = new Map<string, boolean>();
    expect(arrivals(seen, [agent({ moving: true })])).toEqual([]);
    expect(arrivals(seen, [agent({ moving: false })])).toEqual(["Sill"]);
    expect(arrivals(seen, [agent({ moving: false })]), "not again while it stands there").toEqual([]);
  });

  it("does not fire for an agent walking home, a person, or somebody walking up to talk", () => {
    const seen = new Map<string, boolean>([["Sill", true], ["nikk2", true], ["Inkstone", true]]);
    expect(arrivals(seen, [
      agent({ because: null }),
      { actorId: "nikk2", kind: "human", moving: false, because: "moved a card" },
      agent({ actorId: "Inkstone", because: "talking with nikk2" }),
    ])).toEqual([]);
  });

  it("throws sparks up and out, then lets them fall and fade", () => {
    const velocities = burstVelocities(7, 20);
    const positions = new Float32Array(60);
    for (let i = 1; i < velocities.length; i += 3) expect(velocities[i]).toBeGreaterThan(0);
    for (let t = 0; t < 30; t += 1) stepSparkles(positions, velocities, 1 / 30);
    expect(positions.some((value, index) => index % 3 === 1 && value > 0)).toBe(true);
    for (let t = 0; t < 90; t += 1) stepSparkles(positions, velocities, 1 / 30);
    expect(positions.every((value, index) => index % 3 !== 1 || value < 0.5), "they come down").toBe(true);
    expect(sparkleOpacity(0)).toBe(1);
    expect(sparkleOpacity(SPARKLE_LIFE_S)).toBe(0);
  });
});
