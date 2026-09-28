import { describe, expect, it } from "vitest";
import { controllersConfirmed } from "./mic-gesture-input";
import { closedButtons } from "./touch-press";

describe("the touch mic button is for controllers only (Nikk, 2026-09-28)", () => {
  it("never shows because bare hands dropped out of tracking", () => {
    // Hands lost for a minute, and no controller tracked: no buttons.
    expect(controllersConfirmed(0, 0, 60_000)).toBe(false);
    expect(closedButtons(!controllersConfirmed(0, 0, 60_000), false)).toEqual([]);
  });
  it("does not count a controller left on the table while hands are in use", () => {
    expect(controllersConfirmed(1, 59_000, 60_000)).toBe(false);
  });
  it("shows once controllers are held and hands have gone", () => {
    expect(controllersConfirmed(2, -Infinity, 1000)).toBe(true);
    expect(closedButtons(!controllersConfirmed(2, -Infinity, 1000), false)).toEqual(["talk"]);
  });
});
