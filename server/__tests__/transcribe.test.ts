import { describe, expect, it } from "vitest";
import { readTranscript } from "../space/transcribe.js";

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
