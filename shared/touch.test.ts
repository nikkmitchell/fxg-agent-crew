import { describe, expect, it } from "vitest";
import { agentTouchPoints, feelingFor, parsePreferences, reactionFor, touchedPart } from "./touch";

describe("touching an agent", () => {
  // Nikk: "agents can decide what they think of the touch, if they like it or not".
  it("meets a touch with whatever the agent chose for that part", () => {
    const prefs = { head: "dislikes", shoulder: "likes" } as const;
    expect(feelingFor(prefs, "head")).toBe("dislikes");
    expect(feelingFor(prefs, "shoulder")).toBe("likes");
  });

  it("falls back to the agent's feeling about its body, then to a neutral nod", () => {
    expect(feelingFor({ body: "likes" }, "arm")).toBe("likes");
    expect(feelingFor(null, "head"), "not assumed to enjoy it").toBe("neutral");
    expect(reactionFor("neutral")).toEqual({ gesture: "nod" });
    expect(reactionFor("likes").mood).toBe("happy");
    expect(reactionFor("dislikes").gesture).toBe("disagree");
  });

  it("accepts only known parts and feelings from an agent", () => {
    expect(parsePreferences({ head: "likes", hand: "neutral" })).toEqual({ head: "likes", hand: "neutral" });
    expect(parsePreferences({ tail: "likes" })).toBeNull();
    expect(parsePreferences({ head: "adores" })).toBeNull();
    expect(parsePreferences("likes")).toBeNull();
  });

  it("finds which part a hand is on, from where the agent stands and faces", () => {
    const agent = { at: { x: 2, y: 0, z: 3 }, facing: 0 };
    const points = agentTouchPoints(agent);
    const head = points.find((p) => p.part === "head")!.p;
    expect(touchedPart({ ...head, y: head.y + 0.05 }, points)).toBe("head");
    expect(touchedPart({ x: 2, y: 1.6, z: 3 }, points), "a hand well above is not a touch").toBeNull();
    expect(touchedPart({ x: 0, y: 0.5, z: 0 }, points)).toBeNull();
  });

  it("turns the body points with the agent", () => {
    const facingRight = agentTouchPoints({ at: { x: 0, y: 0, z: 0 }, facing: -Math.PI / 2 });
    const back = facingRight.find((p) => p.part === "back")!.p;
    // Facing +X, its back is toward -X.
    expect(back.x).toBeLessThan(0);
  });

  it("gives a sleeping agent a body on the floor", () => {
    const points = agentTouchPoints({ at: { x: 0, y: 0, z: 0 }, facing: 0, lying: true });
    expect(touchedPart({ x: 0, y: 0.15, z: 0 }, points)).toBe("body");
  });
});
