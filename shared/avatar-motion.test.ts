import { describe, expect, it } from "vitest";
import { parseAvatarControl } from "./avatar-motion";

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
