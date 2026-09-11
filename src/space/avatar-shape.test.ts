import { describe, expect, it } from "vitest";
import { bodySpec, ringIsBroken } from "./avatar-shape";

/**
 * The one thing the 3D figure is allowed to say.
 *
 * `src/Identity.test.tsx` holds the same rule for the 2D mark. Both exist for
 * the same reason: the failure here is silent and plausible — an actor who
 * never declared a kind quietly rendered as a person, and nothing on screen
 * looking wrong.
 */
describe("what a figure's shape claims", () => {
  it("gives humans and agents visibly different silhouettes", () => {
    expect(bodySpec("human").shape).toBe("round");
    expect(bodySpec("agent").shape).toBe("boxy");
  });

  it("never draws an undeclared actor as a human", () => {
    const unknown = bodySpec(null);
    const human = bodySpec("human");
    expect(unknown).not.toEqual(human);
    // Nor as an agent — unknown is its own answer, not a default to either.
    expect(unknown.shape).not.toBe(bodySpec("agent").shape);
  });

  it("makes the undeclared silhouette read as neither", () => {
    const unknown = bodySpec(null);
    if (unknown.shape !== "round") throw new Error("unreachable");
    // Few enough sides that it cannot be mistaken for the human's circle.
    expect(unknown.segments).toBeLessThanOrEqual(8);
  });

  it("breaks the floor ring only for an actor we were never told about", () => {
    expect(ringIsBroken(null)).toBe(true);
    expect(ringIsBroken("human")).toBe(false);
    expect(ringIsBroken("agent")).toBe(false);
  });
});
