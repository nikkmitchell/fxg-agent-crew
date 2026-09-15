import { describe, expect, it } from "vitest";
import { compensateReset, headInRoom, type Placed } from "./recenter";

const head = (origin: Placed, local: Placed) => headInRoom(origin, local);
const close = (got: Placed, want: Placed) => {
  expect(got.x).toBeCloseTo(want.x, 9);
  expect(got.z).toBeCloseTo(want.z, 9);
  // Both, so half a turn out is a failure rather than a pass.
  expect(Math.sin(got.yaw - want.yaw)).toBeCloseTo(0, 9);
  expect(Math.cos(got.yaw - want.yaw)).toBeCloseTo(1, 9);
};

/**
 * A headset re-centre moves the space every pose is measured in. The person
 * must stay where they were standing in the room — Nikk: "I just automatically
 * teleport on my own without me doing anything."
 */
describe("when the headset re-centres itself", () => {
  it("keeps the person standing where they were, facing where they faced", () => {
    const origin: Placed = { x: 2, z: -3, yaw: 0.7 };
    // The head, measured within the player's own frame, before and after the
    // reset: the device has decided the person is somewhere else in their room.
    const was: Placed = { x: 0.4, z: -0.2, yaw: 0.3 };
    const now: Placed = { x: -1.1, z: 0.9, yaw: -1.2 };

    const before = head(origin, was);
    const after = head(origin, now);
    expect(after.x).not.toBeCloseTo(before.x, 2);

    const moved = compensateReset(origin, before, after);
    close(head(moved, now), before);
  });

  it("does nothing when the reset changed nothing", () => {
    const origin: Placed = { x: -1.5, z: 4, yaw: -2.2 };
    const local: Placed = { x: 0.2, z: 0.1, yaw: 1 };
    const same = head(origin, local);
    close(compensateReset(origin, same, same), origin);
  });

  it("handles a device that only turned, and one that only moved", () => {
    const origin: Placed = { x: 0, z: 0, yaw: 0 };
    const was: Placed = { x: 1, z: 0, yaw: 0 };
    const before = head(origin, was);

    // Re-centred on the spot: the head reads the same place, facing elsewhere.
    const turnedOnly: Placed = { ...was, yaw: Math.PI / 2 };
    close(head(compensateReset(origin, before, head(origin, turnedOnly)), turnedOnly), before);

    // Tracking found the person a step away, facing the same way.
    const steppedOnly: Placed = { x: was.x + 0.8, z: was.z - 0.4, yaw: was.yaw };
    close(head(compensateReset(origin, before, head(origin, steppedOnly)), steppedOnly), before);
  });
});
