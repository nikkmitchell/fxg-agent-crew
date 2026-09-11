import { describe, expect, it } from "vitest";
import { DETAIL_LIMIT, SPOKEN_LIMIT, refusalFor } from "./voice";

/**
 * How much an agent may say out loud.
 *
 * This is the rule Nikk asked for — agents brief with people, detailed with
 * each other — and it only holds if the SHAPE enforces it. Every test here is
 * really asking the same question: can a long speech reach a person's ears?
 */

const words = (n: number) => "word ".repeat(n).trim();

describe("what may be spoken aloud", () => {
  it("accepts a few short words", () => {
    expect(refusalFor({ say: "Moved that card to review.", source: "text" })).toBeNull();
  });

  it("refuses a speech, and says where to put it instead", () => {
    const refusal = refusalFor({ say: words(200), source: "text" });
    expect(refusal).toBeTruthy();
    // The refusal has to be actionable. A speaker told only "no" says it again.
    expect(refusal).toContain("detail");
  });

  it("lets the same words through when they are written rather than spoken", () => {
    // The point of the split: length is fine, it just does not go to a speaker.
    expect(refusalFor({ detail: words(200), source: "text" })).toBeNull();
  });

  it("allows a long detail alongside a short spoken line", () => {
    expect(
      refusalFor({ say: "Two problems with it.", detail: words(500), source: "text" }),
    ).toBeNull();
  });

  it("refuses a detail beyond even the generous limit", () => {
    expect(refusalFor({ detail: "x".repeat(DETAIL_LIMIT + 1), source: "text" })).toBeTruthy();
  });

  it("refuses an utterance with nothing in it", () => {
    expect(refusalFor({ source: "text" })).toBeTruthy();
    expect(refusalFor({ say: "   ", source: "voice" })).toBeTruthy();
  });

  it("keeps the spoken limit short enough to be worth calling a limit", () => {
    // A guard against the cap being "raised slightly" until it means nothing.
    // Roughly eight seconds of speech; a person in a headset cannot skim.
    expect(SPOKEN_LIMIT).toBeLessThanOrEqual(400);
  });
});

describe("how the words arrived", () => {
  it("accepts a confidence on a transcript", () => {
    expect(refusalFor({ say: "hello", source: "voice", confidence: 0.82 })).toBeNull();
  });

  it("refuses a confidence on something typed", () => {
    // Typed text is not a guess, and a confidence score on it would be theatre.
    expect(refusalFor({ say: "hello", source: "text", confidence: 0.82 })).toBeTruthy();
  });

  it("refuses a confidence that is not a probability", () => {
    for (const confidence of [-0.1, 1.2, Number.NaN]) {
      expect(refusalFor({ say: "hi", source: "voice", confidence }), String(confidence)).toBeTruthy();
    }
  });
});
