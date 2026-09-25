import { describe, expect, it } from "vitest";
import { handNear, IDLE_OPACITY, NEAR, touchPresses, type TouchButton } from "./touch-press";

const gear: TouchButton = { id: "gear", at: { x: 0, y: 1.3, z: -0.3 }, radius: 0.045 };
const mic: TouchButton = { id: "mic", at: { x: 0.11, y: 1.3, z: -0.3 }, radius: 0.045 };
const on = (b: TouchButton, dx = 0) => ({ x: b.at.x + dx, y: b.at.y, z: b.at.z });

describe("pressing by touch", () => {
  it("presses once on the way in, not every frame a finger rests there", () => {
    const first = touchPresses([gear, mic], [on(gear), null], new Set());
    expect(first.pressed).toEqual(["gear"]);
    const resting = touchPresses([gear, mic], [on(gear), null], first.inside);
    expect(resting.pressed).toEqual([]);
  });

  it("presses again only after the finger has left", () => {
    const inside = touchPresses([gear], [on(gear)], new Set()).inside;
    const left = touchPresses([gear], [{ x: 0, y: 1.6, z: 0 }], inside);
    expect(left.inside.size).toBe(0);
    expect(touchPresses([gear], [on(gear)], left.inside).pressed).toEqual(["gear"]);
  });

  it("a finger beside the button, past its edge, does not press it", () => {
    expect(touchPresses([gear], [on(gear, 0.08)], new Set()).pressed).toEqual([]);
  });

  it("either hand, or a controller, can press; no hand at all presses nothing", () => {
    expect(touchPresses([gear, mic], [null, on(mic)], new Set()).pressed).toEqual(["mic"]);
    expect(touchPresses([gear, mic], [null, null], new Set()).pressed).toEqual([]);
  });
});

describe("how visible they are", () => {
  it("is full strength with a hand near, and 30% otherwise", () => {
    expect(handNear([gear], [on(gear, NEAR - 0.01)])).toBe(true);
    expect(handNear([gear], [on(gear, NEAR + 0.05), null])).toBe(false);
    expect(IDLE_OPACITY).toBe(0.3);
  });
});
