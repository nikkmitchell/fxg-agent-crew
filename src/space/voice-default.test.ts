import { describe, expect, it } from "vitest";
import { shouldStartVoice } from "./voice-default";

const start = (over: Partial<Parameters<typeof shouldStartVoice>[0]> = {}) =>
  shouldStartVoice({ selfMuted: false, alreadyOn: false, immersive: false, permission: "prompt", ...over });

describe("voice on from the start (Nikk)", () => {
  it("turns on by itself on the page, even before the browser has asked", () => {
    expect(start()).toBe(true);
    expect(start({ permission: "granted" })).toBe(true);
    expect(start({ permission: "unknown" })).toBe(true);
  });

  it("keeps a mute you chose, and does not ask again after a refusal", () => {
    expect(start({ selfMuted: true })).toBe(false);
    expect(start({ permission: "denied" })).toBe(false);
    expect(start({ alreadyOn: true })).toBe(false);
  });

  it("never opens a permission dialog inside a headset session (Sill, 5452)", () => {
    expect(start({ immersive: true, permission: "prompt" })).toBe(false);
    expect(start({ immersive: true, permission: "unknown" })).toBe(false);
    expect(start({ immersive: true, permission: "granted" })).toBe(true);
  });
});
