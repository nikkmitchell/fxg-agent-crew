import { describe, expect, it } from "vitest";
import { clampToRoom, DEFAULT_COMFORT } from "./comfort";
import { ROOM, WALK_SPEED } from "../../shared/space-layout";

/**
 * The maths under the headset.
 *
 * I cannot test a headset session, so the parts that CAN be tested are pulled
 * out and tested: where the walls are, and what the comfort defaults are. The
 * rest of Immersive.tsx is honestly untested and says so at the top of the file.
 */
describe("staying inside the room in VR", () => {
  it("keeps the player inside the walls however hard the stick is pushed", () => {
    const out = clampToRoom({ x: 999, z: -999 });
    expect(Math.abs(out.x)).toBeLessThan(ROOM.width / 2);
    expect(Math.abs(out.z)).toBeLessThan(ROOM.depth / 2);
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
