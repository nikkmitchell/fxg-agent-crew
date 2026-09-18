import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_PREFERENCES,
  clampPointer,
  parseRoomPreferences,
  pointerLabel,
  stepPointer,
} from "./room-preferences";

describe("how one person likes the room drawn", () => {
  it("starts with no rings, the pointer at 70%, and everybody shown", () => {
    // Nikk: rings "automatically off when you start"; the pointer "start
    // automatically at 70%"; still avatars hidden only by choice, "though
    // don't hide them automatically".
    expect(DEFAULT_ROOM_PREFERENCES).toEqual({ rings: false, pointer: 0.7, hideStill: false });
    expect(parseRoomPreferences(null)).toEqual(DEFAULT_ROOM_PREFERENCES);
  });

  it("keeps what was chosen, and ignores anything it cannot read", () => {
    expect(parseRoomPreferences({ rings: true, pointer: 0.6, hideStill: true })).toEqual({
      rings: true,
      pointer: 0.6,
      hideStill: true,
    });
    expect(parseRoomPreferences({ rings: "yes", pointer: "bright", hideStill: "yes" })).toEqual(DEFAULT_ROOM_PREFERENCES);
    expect(parseRoomPreferences({ pointer: 7 }).pointer).toBe(1);
  });

  it("hides nobody unless it was plainly asked to", () => {
    // Anything in storage that is not a real `true` leaves everybody visible:
    // hiding people by accident is the worse way to be wrong.
    for (const odd of ["true", 1, {}, null]) expect(parseRoomPreferences({ hideStill: odd }).hideStill).toBe(false);
    // Stored before the setting existed: nobody disappears after an update.
    expect(parseRoomPreferences({ rings: true, pointer: 0.5 }).hideStill).toBe(false);
  });

  it("steps the pointer from 0% to 100% in tenths, and no further", () => {
    let value = 0.1;
    for (let press = 0; press < 12; press += 1) value = stepPointer(value, 1);
    expect(value).toBe(1);
    for (let press = 0; press < 12; press += 1) value = stepPointer(value, -1);
    expect(value).toBe(0);
    expect(stepPointer(0.2, 1)).toBe(0.3);
    expect(clampPointer(0.30000000000000004)).toBe(0.3);
  });

  it("says off rather than 0%", () => {
    expect(pointerLabel(0)).toBe("off");
    expect(pointerLabel(0.1)).toBe("10%");
    expect(pointerLabel(1)).toBe("100%");
  });
});
