import { describe, expect, test } from "vitest";
import { faceRoomYaw } from "./vrm-model";

/**
 * The room's forward is -Z. These are the two answers three-vrm gives for
 * `lookAt.faceFront`, and the bug they are here to stop coming back is the
 * one Nikk saw in a headset: a whole room of people with their backs to him.
 */
describe("faceRoomYaw", () => {
  test("a model that already faces -Z is left alone", () => {
    expect(faceRoomYaw(-1)).toBe(0);
  });

  test("a model that faces +Z is turned half a turn", () => {
    expect(faceRoomYaw(1)).toBe(Math.PI);
  });

  test("the VRM 0.x file this room ships needs no correction", () => {
    // three-vrm imports a 0.x model with faceFront (0, 0, -1) — see the
    // `_v0ImportLookAt` path, which also negates the first-person eye offset.
    expect(faceRoomYaw(-1)).toBe(0);
  });
});
