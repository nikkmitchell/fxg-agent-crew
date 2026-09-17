import { describe, expect, it } from "vitest";
import { MAX_GESTURE_HOLD_MS, parseAvatarControl } from "./avatar-motion";

describe("avatar controls", () => {
  it("accepts the bounded mood and gesture vocabulary", () => {
    expect(parseAvatarControl({ mood: "focused", gesture: "nod" })).toEqual({
      mood: "focused",
      gesture: "nod",
    });
  });

  it("allows either field independently", () => {
    expect(parseAvatarControl({ gesture: "none" })).toEqual({ gesture: "none" });
    expect(parseAvatarControl({ mood: "happy" })).toEqual({ mood: "happy" });
    expect(parseAvatarControl({ posture: "listening" })).toEqual({ posture: "listening" });
    expect(parseAvatarControl({ gesture: "clap" })).toEqual({ gesture: "clap" });
  });

  it("refuses arbitrary animation names and empty controls", () => {
    expect(parseAvatarControl({ gesture: "download-and-run-this" })).toBeNull();
    expect(parseAvatarControl({ mood: "ecstatic" })).toBeNull();
    expect(parseAvatarControl({})).toBeNull();
  });
});

/**
 * HOLDING A GESTURE, which used to be impossible.
 *
 * Waffle, working from outside the room, was asked by clem to hold an emote and
 * had to re-issue it on a timer, because five seconds was not the default —
 * it was the maximum. Their summary of the whole class: "the presence API can
 * declare a state but not perform an action over time".
 */
describe("asking to hold a gesture", () => {
  it("accepts a duration alongside a gesture", () => {
    expect(parseAvatarControl({ gesture: "wave", holdMs: 12_000 }))
      .toEqual({ gesture: "wave", holdMs: 12_000 });
  });

  it("clamps an unreasonable wish instead of refusing it", () => {
    // Deliberately unlike every other field here, which is refused on a bad
    // value. Asking to wave for an hour is a reasonable wish with an
    // unreasonable number, and the useful answer is the longest wave allowed.
    const asked = parseAvatarControl({ gesture: "wave", holdMs: 60 * 60 * 1000 });
    expect(asked).toEqual({ gesture: "wave", holdMs: MAX_GESTURE_HOLD_MS });
  });

  it("refuses a hold that is not a positive number, because that is a typo", () => {
    for (const holdMs of ["5s", null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(parseAvatarControl({ gesture: "wave", holdMs }), `holdMs ${String(holdMs)}`).toBeNull();
    }
  });

  it("rounds a fractional hold rather than refusing it", () => {
    expect(parseAvatarControl({ gesture: "nod", holdMs: 1500.7 }))
      .toEqual({ gesture: "nod", holdMs: 1501 });
  });

  it("still needs a real field: a hold on its own says nothing", () => {
    expect(parseAvatarControl({ holdMs: 3000 })).toBeNull();
  });
});
