import { describe, expect, it } from "vitest";
import { controllerMicAction, isPressed } from "./controller-mic";

describe("the microphone on the controller's buttons (Nikk, 2026-09-28)", () => {
  it("A or X starts, and pressed again finishes and sends", () => {
    expect(controllerMicAction("talk", false, true)).toBe("start");
    expect(controllerMicAction("talk", true, true)).toBe("finish");
  });
  it("B or Y cancels a recording, and does nothing otherwise", () => {
    expect(controllerMicAction("cancel", true, true)).toBe("cancel");
    expect(controllerMicAction("cancel", false, true)).toBeNull();
  });
  it("A or X does nothing when a recording could not start (mid-send, no microphone)", () => {
    expect(controllerMicAction("talk", false, false)).toBeNull();
  });
  it("counts pressed, not touched, as down", () => {
    expect(isPressed({ state: "pressed" })).toBe(true);
    expect(isPressed({ state: "touched" })).toBe(false);
    expect(isPressed(undefined)).toBe(false);
  });
});
