import { describe, expect, it } from "vitest";
import { hearableFrom } from "./useVoiceChat";

describe("who you can mute (Nikk, 2026-09-28)", () => {
  it("lists the other people in the room even when nobody is talking", () => {
    expect(hearableFrom("Nikk2", ["Nikk2", "baiwei2", "Guest"], [])).toEqual(["baiwei2", "Guest"]);
  });
  it("adds anyone talking who is not on the room list, once, and never you", () => {
    expect(hearableFrom("nikk2", ["Nikk2", "baiwei2"], ["BAIWEI2", "Visitor", "Nikk2"])).toEqual(["baiwei2", "Visitor"]);
  });
});
