import { describe, expect, it } from "vitest";
import { LOOK_SENSITIVITY, MAX_PITCH, clampPitch, tiltBy } from "./look-pitch";

/**
 * Nikk: "add a pitch control for the fps controller there, so we can look
 * down". The flat view turned but never tilted, so the floor — and every
 * figure's feet, and the whole question of whether a body stands ON the ground
 * — could not be looked at from the one view whose job is checking the room.
 */
describe("looking up and down in the window", () => {
  it("looks down when you drag down, and up when you drag up", () => {
    // Negative pitch is downward in three's YXZ camera, which is the sign most
    // easily got backwards; this is the assertion that pins the direction.
    expect(tiltBy(0, 100)).toBeLessThan(0);
    expect(tiltBy(0, -100)).toBeGreaterThan(0);
  });

  it("moves by the same amount per pixel as turning does", () => {
    expect(tiltBy(0, -50)).toBeCloseTo(50 * LOOK_SENSITIVITY, 12);
  });

  it("lets you look very nearly straight down, because that was the request", () => {
    // A polite 60 degree limit would leave the floor at your feet out of shot,
    // which is exactly the thing this exists to make visible.
    const staringAtTheFloor = tiltBy(0, 100_000);
    expect(staringAtTheFloor).toBeCloseTo(-MAX_PITCH, 12);
    expect(Math.abs(staringAtTheFloor)).toBeGreaterThan((89 * Math.PI) / 180);
  });

  it("never reaches the angle where the camera gimbal-locks or flips", () => {
    // At exactly ±90° in YXZ the yaw and roll axes coincide; past it the view
    // turns upside down and the horizon rolls. Neither gets reported as "the
    // clamp is missing" — it gets reported as "the room went strange".
    for (const drag of [1e3, 1e5, -1e5, Number.MAX_SAFE_INTEGER]) {
      expect(Math.abs(tiltBy(0, drag))).toBeLessThan(Math.PI / 2);
    }
  });

  it("clamps from wherever you already were, not just from level", () => {
    // Dragging further down while already at the limit must not creep past it.
    expect(tiltBy(-MAX_PITCH, 500)).toBeCloseTo(-MAX_PITCH, 12);
    expect(tiltBy(MAX_PITCH, -500)).toBeCloseTo(MAX_PITCH, 12);
  });

  it("leaves a small drag alone rather than snapping it anywhere", () => {
    expect(clampPitch(0.3)).toBe(0.3);
    expect(tiltBy(0.3, 0)).toBe(0.3);
  });

  it("recovers to level from a pitch that is not a number", () => {
    // A NaN here would put the camera's rotation matrix beyond repair and the
    // view would go black with nothing in the console to explain it.
    expect(clampPitch(Number.NaN)).toBe(0);
    expect(clampPitch(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
