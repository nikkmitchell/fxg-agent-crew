import { describe, expect, it } from "vitest";
import { clampToRoom, DEFAULT_COMFORT } from "./comfort";
import { ROOM, WALK_SPEED, WORLD } from "../../shared/space-layout";

/**
 * The maths under the headset.
 *
 * I cannot test a headset session, so the parts that CAN be tested are pulled
 * out and tested: how far the stick may take you, and what the comfort
 * defaults are. The rest of Immersive.tsx is honestly untested and says so at
 * the top of the file.
 */
describe("walking in VR, with no boundary", () => {
  // Nikk: "remove the limited walking boundary we don't want to have any limit
  // to walking". This test asserted the opposite until then, and is inverted
  // rather than deleted: the old wall is the thing most likely to creep back.
  it("lets the stick take you far outside the old walls", () => {
    const out = clampToRoom({ x: 999, z: -999 });
    expect(out.x, "999 m out is where you asked to be").toBe(999);
    expect(out.z).toBe(-999);
    expect(Math.abs(out.x)).toBeGreaterThan(ROOM.width / 2);
  });

  it("still refuses to hand back a position that is not a number", () => {
    // Not a wall: arithmetic. Other people's positions are computed against
    // this one, and a NaN would spread to every figure in the room.
    //
    // NaN AND INFINITY BOTH BECOME THE ORIGIN, rather than the far bound. A
    // garbage sample should leave you somewhere you can be seen and walk back
    // from; pinning it to 10 km would "succeed" and lose the person.
    expect(clampToRoom({ x: Number.NaN, z: 3 })).toEqual({ x: 0, z: 3 });
    expect(clampToRoom({ x: Number.POSITIVE_INFINITY, z: 0 })).toEqual({ x: 0, z: 0 });
    // A merely absurd number is a number, so it is bounded rather than reset.
    expect(clampToRoom({ x: 1e9, z: 0 })).toEqual({ x: WORLD.half, z: 0 });
  });

  it("leaves somebody in the middle of the room exactly where they are", () => {
    expect(clampToRoom({ x: 1.5, z: -2 })).toEqual({ x: 1.5, z: -2 });
  });
});

describe("comfort defaults", () => {
  it("defaults to snap turning even though smooth was the stated preference", () => {
    // Smooth locomotion makes some people ill, and a first session that makes
    // somebody sick is not a setting they get the chance to change. Snap is one
    // click away from smooth; nausea is not one click away from anything.
    expect(DEFAULT_COMFORT.turn).toBe("snap");
  });

  it("moves at the same speed as everybody else in the room", () => {
    // A player who outruns the avatars looks like a camera, not a person.
    expect(DEFAULT_COMFORT.speed).toBe(WALK_SPEED);
  });
});
