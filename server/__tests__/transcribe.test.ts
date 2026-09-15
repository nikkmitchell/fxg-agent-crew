import { describe, expect, it } from "vitest";
import {
  TRANSCRIBE_CEILING_MS,
  TRANSCRIBE_FLOOR_MS,
  namesPrompt,
  readTranscript,
  timeoutFor,
} from "../space/transcribe.js";

/**
 * What comes back from whisper is not a sentence: it is a printout, and what it
 * prints depends on flags and model. The room must never paste a timestamp or
 * the transcriber's own aside about silence into the chat under somebody's name.
 */
describe("reading words out of a transcriber's printout", () => {
  it("keeps plain text as it is", () => {
    expect(readTranscript(" hello Plumbline, can you look at the board?\n")).toBe(
      "hello Plumbline, can you look at the board?",
    );
  });

  it("strips the timestamps a flag change could bring back", () => {
    const output = "[00:00:00.000 --> 00:00:02.480]   move my home to where I am standing\n";
    expect(readTranscript(output)).toBe("move my home to where I am standing");
  });

  it("joins several lines into one utterance", () => {
    expect(readTranscript("first part\nsecond part\n\nthird\n")).toBe("first part second part third");
  });

  it("throws away the transcriber talking about itself", () => {
    // A held button and no speech gives exactly this, and "(BLANK_AUDIO)" sent
    // to the group under somebody's name is worse than sending nothing.
    expect(readTranscript("[BLANK_AUDIO]\n")).toBe("");
    expect(readTranscript("(silence)\n")).toBe("");
    expect(readTranscript("[00:00:00.000 --> 00:00:01.000]  [BLANK_AUDIO]\n")).toBe("");
  });

  it("is empty for empty output, which the route reports as heard: false", () => {
    expect(readTranscript("")).toBe("");
    expect(readTranscript("\n\n  \n")).toBe("");
  });

  it("does not mistake a sentence in brackets for an aside", () => {
    expect(readTranscript("(I think that is the right answer)")).toBe("(I think that is the right answer)");
  });

  it("collapses the runs of spaces whisper pads its lines with", () => {
    expect(readTranscript("  hello    there  \n")).toBe("hello there");
  });
});

describe("how long a transcription is given", () => {
  it("scales with the recording, because a fixed timeout was wrong at both ends", () => {
    // Measured on saha.ing: tiny.en does 11 s of speech in 4 s. A flat 30 s
    // therefore covered about 80 s of speech while the route accepted four
    // minutes of it, so a long sentence was recorded, uploaded, worked on and
    // then thrown away.
    const seconds = (n: number) => 44 + n * 32_000;
    expect(timeoutFor(seconds(30)), "thirty seconds of speech gets ninety").toBe(90_000);
    expect(timeoutFor(seconds(50))).toBeGreaterThan(timeoutFor(seconds(30)));
    // The clip that used to fail: 100 seconds of speech takes tiny.en about 36,
    // and the old flat timeout gave it 30.
    expect(timeoutFor(seconds(100))).toBeGreaterThan(36_000);
  });

  it("never gives less than the floor, so loading the model is not counted against a short clip", () => {
    expect(timeoutFor(44)).toBe(TRANSCRIBE_FLOOR_MS);
    expect(timeoutFor(0)).toBe(TRANSCRIBE_FLOOR_MS);
    expect(timeoutFor(44 + 32_000)).toBe(TRANSCRIBE_FLOOR_MS);
  });

  it("never gives more than the ceiling, so a wedged child cannot hold a core for ever", () => {
    expect(timeoutFor(44 + 600 * 32_000)).toBe(TRANSCRIBE_CEILING_MS);
  });
});

describe("telling the transcriber who is in the room", () => {
  it("lists the names and the site, because a small model has seen neither", () => {
    expect(namesPrompt(["Sill", "Plumbline"])).toBe("Sill, Plumbline, saha.ing");
  });

  it("drops anything that would read as two names", () => {
    expect(namesPrompt(["Sill", "claude nikk2mbp", "a,b", "  "])).toBe("Sill, saha.ing");
  });

  it("says each name once, however the database spells it", () => {
    expect(namesPrompt(["Sill", "sill", "SILL"])).toBe("Sill, saha.ing");
  });

  it("stops well short of the prompt's limit rather than losing the tail silently", () => {
    const many = Array.from({ length: 200 }, (_, i) => `agent${i}`);
    expect(namesPrompt(many).split(", ").length).toBeLessThanOrEqual(40);
  });

  it("still names the site when the room is empty", () => {
    expect(namesPrompt([])).toBe("saha.ing");
  });
});
