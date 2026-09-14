import { describe, expect, it } from "vitest";
import { DETAIL_LIMIT, SPOKEN_LIMIT, refusalFor, CHAT_MESSAGE_LIMIT, splitForChat } from "./voice";

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

  it("no longer refuses a speech for being long, it splits it", () => {
    /**
     * THIS TEST USED TO ASSERT A REFUSAL, and the reasoning behind that
     * refusal was about discarding words: "silently shortening tells the
     * sender their words were used when they were not". Correct worry, wrong
     * remedy — refusing discards ALL of them and makes somebody in a headset
     * say the whole thing again. Nikk, blocked by it mid-sentence: "please
     * remove any limit here."
     *
     * Inverted rather than deleted, so the reversal is in the history.
     */
    expect(refusalFor({ say: words(200), source: "text" })).toBeNull();
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

describe("splitting a long voice message for the chat", () => {
  const long = (sentences: number) =>
    Array.from({ length: sentences }, (_, i) => `This is sentence number ${i + 1} of a long voice message.`).join(" ");

  it("leaves a message that already fits as one part", () => {
    expect(splitForChat("short and sweet")).toEqual(["short and sweet"]);
  });

  it("never produces a part over the chat limit, however long the input", () => {
    // The failure this fixes: WebHarness refuses a message over 2000
    // characters, so a long dictation bounced off the chat.
    const parts = splitForChat(long(200));
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(part.length).toBeLessThanOrEqual(CHAT_MESSAGE_LIMIT);
  });

  it("loses nothing: the parts rejoin into exactly the original words", () => {
    // A splitter that drops the space it cut at, or a word at a seam, is the
    // quiet loss this whole change exists to prevent.
    const text = long(200);
    expect(splitForChat(text).join(" ")).toBe(text);
  });

  it("leaves room for a part number in front of every part", () => {
    const reserve = "(99/99) ".length;
    for (const part of splitForChat(long(200), CHAT_MESSAGE_LIMIT, reserve)) {
      expect(`(99/99) ${part}`.length).toBeLessThanOrEqual(CHAT_MESSAGE_LIMIT);
    }
  });

  it("cuts between sentences when it can", () => {
    for (const part of splitForChat(long(200)).slice(0, -1)) {
      expect(part.endsWith(".")).toBe(true);
    }
  });

  it("cuts between words, never inside one, when a sentence is itself too long", () => {
    const text = Array.from({ length: 800 }, (_, i) => `word${i}`).join(" ");
    const parts = splitForChat(text);
    expect(parts.join(" ")).toBe(text);
    for (const part of parts) {
      expect(part.length).toBeLessThanOrEqual(CHAT_MESSAGE_LIMIT);
      expect(part.startsWith("word")).toBe(true);
    }
  });
});
