import { describe, expect, it } from "vitest";
import type { Utterance } from "../../shared/voice";
import { shouldSpeakUtterance } from "./VoiceControls";

const utterance = (changes: Partial<Utterance> = {}): Utterance => ({
  id: 1,
  at: "2026-09-12T00:00:00.000Z",
  actorId: "Plumbline",
  to: "Wilson",
  say: "Short answer",
  detail: "Long written context",
  source: "text",
  confidence: null,
  ...changes,
});

describe("spoken reply policy", () => {
  it("speaks a short live reply addressed to the viewer", () => {
    expect(shouldSpeakUtterance(utterance(), "Wilson")).toBe(true);
  });

  it("does not speak broadcasts, self messages, or detail-only messages", () => {
    expect(shouldSpeakUtterance(utterance({ to: null }), "Wilson")).toBe(false);
    expect(shouldSpeakUtterance(utterance({ actorId: "Wilson" }), "Wilson")).toBe(false);
    expect(shouldSpeakUtterance(utterance({ say: null }), "Wilson")).toBe(false);
  });
});
