import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROOM_PREFERENCES,
  clampPointer,
  parseRoomPreferences,
  pointerLabel,
  stepPointer,
} from "./room-preferences";

describe("how one person likes the room drawn", () => {
  it("starts with no rings and a pointer at a tenth of its old brightness", () => {
    // Nikk: rings "automatically off when you start"; the pointer "10% of what it currently is".
    expect(DEFAULT_ROOM_PREFERENCES).toEqual({ rings: false, pointer: 0.1 });
    expect(parseRoomPreferences(null)).toEqual(DEFAULT_ROOM_PREFERENCES);
  });

  it("keeps what was chosen, and ignores anything it cannot read", () => {
    expect(parseRoomPreferences({ rings: true, pointer: 0.6 })).toEqual({ rings: true, pointer: 0.6 });
    expect(parseRoomPreferences({ rings: "yes", pointer: "bright" })).toEqual(DEFAULT_ROOM_PREFERENCES);
    expect(parseRoomPreferences({ pointer: 7 }).pointer).toBe(1);
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
