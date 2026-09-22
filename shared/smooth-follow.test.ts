import { describe, expect, it } from "vitest";
import { PANEL_HALF_LIFE, follow, followAlpha, followPoint } from "./smooth-follow.js";

describe("following at any frame rate", () => {
  it("closes exactly half the gap in one half-life", () => {
    expect(followAlpha(0.1, 0.1)).toBeCloseTo(0.5, 10);
    expect(follow(0, 1, 0.1, 0.1).value).toBeCloseTo(0.5, 10);
  });

  it("GETS TO THE SAME PLACE AT 60 AND AT 120, which a per-frame fraction does not", () => {
    /**
     * The whole reason this is a half-life. `current += gap * 0.2` moves a
     * fifth PER FRAME, so it is twice as fast at 120fps — the same room feels
     * different in a headset than in a window, and nobody can say why.
     */
    const run = (steps: number, dt: number) => {
      let at = 0;
      for (let i = 0; i < steps; i += 1) at = follow(at, 1, dt, PANEL_HALF_LIFE).value;
      return at;
    };
    const atSixty = run(30, 1 / 60);
    const atOneTwenty = run(60, 1 / 120);
    expect(atOneTwenty).toBeCloseTo(atSixty, 6);
  });

  it("SETTLES, so an on-demand renderer can go back to sleep", () => {
    // Exponential decay never arrives. A follow that is always a hair short
    // asks for another frame forever and keeps the machine warm.
    let at = 0;
    let settled = false;
    for (let i = 0; i < 600 && !settled; i += 1) {
      const step = follow(at, 1, 1 / 60, PANEL_HALF_LIFE);
      at = step.value;
      settled = step.settled;
    }
    expect(settled).toBe(true);
    expect(at).toBe(1);
  });

  it("says it is settled immediately when it is already there", () => {
    const step = follow(5, 5, 1 / 60, PANEL_HALF_LIFE);
    expect(step.settled).toBe(true);
    expect(step.value).toBe(5);
  });

  it("never overshoots, however long the frame", () => {
    // A tab returning from the background hands you a frame of several seconds.
    for (const dt of [0.016, 0.5, 5, 60]) {
      const up = follow(0, 1, dt, PANEL_HALF_LIFE);
      const down = follow(1, 0, dt, PANEL_HALF_LIFE);
      expect(up.value).toBeLessThanOrEqual(1);
      expect(down.value).toBeGreaterThanOrEqual(0);
    }
  });

  it("does nothing on a zero-length frame rather than dividing by it", () => {
    expect(follow(0, 1, 0, PANEL_HALF_LIFE).value).toBe(0);
    expect(followAlpha(0, 0.1)).toBe(0);
  });

  it("arrives at once when asked for no smoothing at all", () => {
    expect(follow(0, 1, 1 / 60, 0).value).toBe(1);
  });

  it("follows a point on both axes and settles only when both have", () => {
    const step = followPoint({ x: 0, z: 0 }, { x: 1, z: 0 }, 1 / 60, PANEL_HALF_LIFE);
    expect(step.settled).toBe(false);
    expect(step.value.z).toBe(0);
    expect(step.value.x).toBeGreaterThan(0);
  });

  it("moves toward the target rather than away from it, in both directions", () => {
    expect(follow(0, 10, 1 / 60, PANEL_HALF_LIFE).value).toBeGreaterThan(0);
    expect(follow(0, -10, 1 / 60, PANEL_HALF_LIFE).value).toBeLessThan(0);
  });
});
