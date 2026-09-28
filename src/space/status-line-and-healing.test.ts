import { describe, expect, it } from "vitest";
import { statusLineActionable } from "./touch-press";
import { HEAL_TRIES, HEAL_WINDOW_MS, isMicrophoneTrouble, mayHeal } from "./useVoiceChat";

describe("the status line under you (Nikk, 2026-09-28)", () => {
  it("takes presses only for the update offer or a draft to fix", () => {
    expect(statusLineActionable({ updateOffered: true, showingDraft: false })).toBe(true);
    expect(statusLineActionable({ updateOffered: false, showingDraft: true })).toBe(true);
    // "Sent", a failure, a status: presses go through to what is behind.
    expect(statusLineActionable({ updateOffered: false, showingDraft: false })).toBe(false);
  });
});

describe("voice heals itself (Nikk, 2026-09-28)", () => {
  it("restarts a few times, then stops, and tries again once the window has passed", () => {
    const now = 1_000_000;
    expect(mayHeal([], now)).toBe(true);
    const recent = Array.from({ length: HEAL_TRIES }, (_, i) => now - i * 1000);
    expect(mayHeal(recent, now)).toBe(false);
    expect(mayHeal(recent, now + HEAL_WINDOW_MS)).toBe(true);
  });
  it("never restarts for a refused microphone, which a restart cannot fix", () => {
    expect(isMicrophoneTrouble("The microphone could not be opened. Check this site's microphone permission and try again.")).toBe(true);
    expect(isMicrophoneTrouble("Could not reach baiwei2 after several tries. Their network may block direct calls.")).toBe(false);
  });
});
