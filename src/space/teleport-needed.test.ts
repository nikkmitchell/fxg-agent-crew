import { describe, expect, it } from "vitest";
import { lacksThumbstick, teleportIsTheOnlyWayToMove } from "./teleport-needed";

const withStick = { gamepad: { "xr-standard-thumbstick": {}, "xr-standard-trigger": {} } };
const noStick = { gamepad: { "xr-standard-trigger": {}, "a-button": {} } };
const unknown = { gamepad: {} };

describe("knowing a controller has no thumbstick", () => {
  it("is true only when the profile says so", () => {
    expect(lacksThumbstick(noStick)).toBe(true);
    expect(lacksThumbstick(withStick)).toBe(false);
  });

  /**
   * `gamepad` is filled from the device profile, which arrives asynchronously.
   * Reading "not known yet" as "no thumbstick" would switch teleport on for a
   * moment on every Quest, which is the bug this file exists to end.
   */
  it("is false while nothing is known yet", () => {
    expect(lacksThumbstick(unknown)).toBe(false);
    expect(lacksThumbstick({})).toBe(false);
    expect(lacksThumbstick(undefined)).toBe(false);
  });
});

describe("whether teleport is somebody's only way to move", () => {
  it("is true on a headset with sticklesss controllers and no hand tracking", () => {
    // The XREAL Aura, which is the entire reason the exception exists.
    expect(teleportIsTheOnlyWayToMove({ controllers: [noStick, noStick], handsSeen: false })).toBe(true);
  });

  /**
   * THE BUG, and it hit two people during their own onboarding. Nikk and KANxD
   * each had a stickless controller AND a tracked hand, so the palm joystick
   * worked — and the room turned teleport on over their setting anyway.
   */
  it("is FALSE once a hand has been seen, however stickless the controller", () => {
    expect(teleportIsTheOnlyWayToMove({ controllers: [noStick], handsSeen: true })).toBe(false);
    expect(teleportIsTheOnlyWayToMove({ controllers: [noStick, noStick], handsSeen: true })).toBe(false);
  });

  it("is false when a thumbstick exists, hands or not", () => {
    expect(teleportIsTheOnlyWayToMove({ controllers: [withStick], handsSeen: false })).toBe(false);
    expect(teleportIsTheOnlyWayToMove({ controllers: [withStick], handsSeen: true })).toBe(false);
  });

  it("is false with nothing connected at all, rather than assuming the worst", () => {
    expect(teleportIsTheOnlyWayToMove({ controllers: [undefined, undefined], handsSeen: false })).toBe(false);
    expect(teleportIsTheOnlyWayToMove({ controllers: [], handsSeen: false })).toBe(false);
  });

  it("is true when one of two controllers is known stickless and no hands", () => {
    // One stick is enough to move with, so this is about a pair where the
    // profile of one is still unknown.
    expect(teleportIsTheOnlyWayToMove({ controllers: [unknown, noStick], handsSeen: false })).toBe(true);
    expect(teleportIsTheOnlyWayToMove({ controllers: [withStick, noStick], handsSeen: false })).toBe(false);
  });
});
