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

  /**
   * THE ROOM IS AUDIBLE TO EVERYBODY IN IT. This asserted the opposite until
   * Nikk settled it: "lets have it read to all, like we are all in the room, so
   * even if an agent is saying something to one person, everyone else should
   * still be able to hear it". Standing next to a conversation used to be
   * silent.
   */
  it("speaks a line addressed to somebody else, because you are in the room too", () => {
    expect(shouldSpeakUtterance(utterance({ to: "Inkstone" }), "Wilson")).toBe(true);
  });

  it("speaks a line addressed to nobody in particular", () => {
    expect(shouldSpeakUtterance(utterance({ to: null }), "Wilson")).toBe(true);
  });

  it("does not speak your own voice back at you, or anything with no say", () => {
    expect(shouldSpeakUtterance(utterance({ actorId: "Wilson" }), "Wilson")).toBe(false);
    expect(shouldSpeakUtterance(utterance({ say: null }), "Wilson")).toBe(false);
    expect(shouldSpeakUtterance(utterance({ say: "   " }), "Wilson")).toBe(false);
  });

  it("says nothing to a viewer who is not signed in", () => {
    expect(shouldSpeakUtterance(utterance(), null)).toBe(false);
  });
});
