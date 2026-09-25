import { describe, expect, it } from "vitest";
import {
  CLOSED_AHEAD,
  CLOSED_BELOW_HEAD,
  CLOSED_HEIGHT,
  closedControlPose,
  closedTilt,
  squareOnTilt,
  TILT_FRACTION,
} from "./control-pose";

const deg = (radians: number) => (radians * 180) / Math.PI;

describe("where the closed controls sit", () => {
  it("is lower than the 1.02 it was, which is the whole request", () => {
    // Nikk, from inside a headset: "too high up... make it lower so it doesn't
    // block anyones view". If this ever creeps back up, this is the line.
    expect(CLOSED_HEIGHT).toBeLessThan(1.02);
  });

  it("is still low enough to be below a conversation and high enough to reach", () => {
    // Not an arbitrary range: below about 1.1 it is out of the band two
    // standing people look at each other across, and above about 0.7 it does
    // not require stooping.
    expect(CLOSED_HEIGHT).toBeGreaterThan(0.7);
    expect(CLOSED_HEIGHT).toBeLessThan(1.1);
  });

  it("stays the same distance in front whichever way the wearer faces", () => {
    // The panel eases round rather than being welded to the gaze, so it is
    // asked for a pose at many yaws. If the distance moved with the angle it
    // would swing nearer and further as somebody turned on the spot.
    for (const yaw of [0, 0.4, Math.PI / 2, Math.PI, -2.2, 5.9]) {
      const { position } = closedControlPose({ x: 1.5, z: -0.5 }, yaw);
      const flat = Math.hypot(position[0] - 1.5, position[2] - -0.5);
      expect(flat).toBeCloseTo(CLOSED_AHEAD, 6);
    }
  });

  it("puts the panel in FRONT of the wearer, not behind", () => {
    // The room's forward is -Z, so at yaw 0 the panel belongs at a smaller z.
    const { position } = closedControlPose({ x: 0, z: 0 }, 0);
    expect(position[2]).toBeCloseTo(-CLOSED_AHEAD, 6);
    expect(position[0]).toBeCloseTo(0, 6);
  });

  /** Nikk (4739): "a meter below your head and a half a meter in front". */
  it("hangs a metre below the head and half a metre in front, when the head is known", () => {
    for (const head of [1.2, 1.6, 1.85]) {
      const { position } = closedControlPose({ x: 0, y: head, z: 0 }, 0);
      expect(position[1]).toBeCloseTo(head - CLOSED_BELOW_HEAD, 10);
      expect(position[2]).toBeCloseTo(-CLOSED_AHEAD, 10);
    }
    expect(CLOSED_BELOW_HEAD).toBe(1);
    expect(CLOSED_AHEAD).toBe(0.5);
  });

  it("falls back to the old absolute height when there is no head to go by", () => {
    expect(closedControlPose({ x: 0, z: 0 }, 1).position[1]).toBe(CLOSED_HEIGHT);
  });
});

describe("which way the closed controls face", () => {
  it("pitches UP, not down", () => {
    // The sign is the bug worth guarding. Rotating the face normal about x the
    // positive way points it at the floor, so the applied angle must be
    // negative for the face to come up to meet the eyes.
    const [pitch] = closedControlPose({ x: 0, z: 0 }, 0).rotation;
    expect(pitch).toBeLessThan(0);
  });

  it("used to have no pitch at all, and now has some", () => {
    // `rotation.set(0, yaw, 0)`: the term was absent rather than small.
    expect(closedTilt()).toBeGreaterThan(0);
  });

  it("tilts short of flat, by a margin worth seeing", () => {
    // THE PROPERTY, NOT A DEGREE CEILING. This asserted "< 40 degrees" and
    // failed the moment Nikk asked for more tilt and a lower panel — the panel
    // is now 42.3, and the test was wrong rather than the panel. A fixed
    // ceiling is a second opinion about the design competing with
    // TILT_FRACTION, which is where the decision actually lives.
    //
    // What must stay true is that the face never points straight at the eyes,
    // because that lays a thigh-height panel flat enough to read as a tray
    // rather than a control. Ten degrees of daylight is the claim.
    expect(deg(squareOnTilt()) - deg(closedTilt())).toBeGreaterThan(10);
    // And that it is a real tilt rather than a rounding error.
    expect(deg(closedTilt())).toBeGreaterThan(10);
  });

  it("is exactly the stated fraction of square-on, so the number is not magic", () => {
    expect(closedTilt()).toBeCloseTo(squareOnTilt() * TILT_FRACTION, 10);
  });

  it("works out square-on from the geometry rather than a remembered angle", () => {
    // A panel level with the eyes needs no pitch; one directly below them needs
    // a right angle. Both fall out of the same atan2 the real numbers use.
    expect(squareOnTilt(0.62, 1.6, 1.6)).toBeCloseTo(0, 10);
    // Approaching a right angle rather than reaching one: the panel is never
    // at zero distance, so the limit is the claim, not an exact 90.
    expect(deg(squareOnTilt(0.001, 0.86, 1.6))).toBeGreaterThan(89);
    expect(deg(squareOnTilt(0.001, 0.86, 1.6))).toBeLessThanOrEqual(90);
  });

  it("yaws to face the wearer as well as pitching", () => {
    // Both terms, in the order the renderer applies them: yaw then pitch about
    // the panel's own sideways axis.
    const { rotation } = closedControlPose({ x: 0, z: 0 }, 1.23);
    expect(rotation[1]).toBe(1.23);
    expect(rotation[2]).toBe(0);
  });
});
