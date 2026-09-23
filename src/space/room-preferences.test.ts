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
    // And dark mode ON: "a darkmode that is on automatically".
    expect(DEFAULT_ROOM_PREFERENCES).toEqual({ rings: false, pointer: 0.7, hideStill: false, dark: true });
    expect(parseRoomPreferences(null)).toEqual(DEFAULT_ROOM_PREFERENCES);
  });

  it("keeps what was chosen, and ignores anything it cannot read", () => {
    expect(parseRoomPreferences({ rings: true, pointer: 0.6, hideStill: true, dark: false })).toEqual({
      rings: true,
      pointer: 0.6,
      hideStill: true,
      dark: false,
    });
    expect(parseRoomPreferences({ rings: "yes", pointer: "bright", hideStill: "yes" })).toEqual(DEFAULT_ROOM_PREFERENCES);
    expect(parseRoomPreferences({ pointer: 7 }).pointer).toBe(1);
  });

  /**
   * DARK UNLESS PLAINLY TURNED OFF, and the opposite rule from hideStill for
   * the same reason: each fails in the direction that hurts nobody. A corrupt
   * setting that hid people would lose them; a corrupt setting that turned the
   * room white would put a lit panel back in front of somebody's eyes.
   */
  it("is dark unless it was plainly turned off", () => {
    for (const odd of ["false", 0, {}, null, undefined]) expect(parseRoomPreferences({ dark: odd }).dark).toBe(true);
    expect(parseRoomPreferences({ dark: false }).dark).toBe(false);
  });

  /**
   * EVERYBODY WHO ARRIVED BEFORE IT EXISTED GETS IT. Only chosen fields are
   * stored, so a person who set their rings last week has no `dark` field at
   * all — and must come back to a dark room, not the white one they left.
   */
  it("reaches people whose stored settings predate it", () => {
    expect(parseRoomPreferences({ rings: true, pointer: 0.5 }).dark).toBe(true);
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
