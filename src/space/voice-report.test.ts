import { describe, expect, it } from "vitest";
import { voiceReport } from "./voice-report";

const recorder = { isTypeSupported: (type: string) => type === "audio/webm;codecs=opus" };

describe("what the browser says it can do with speech", () => {
  it("names which recognition object it found, because the prefix is the difference", () => {
    expect(voiceReport({ SpeechRecognition: class {} })).toContain("recognition YES (SpeechRecognition)");
    expect(voiceReport({ webkitSpeechRecognition: class {} })).toContain("recognition YES (webkitSpeechRecognition)");
    expect(voiceReport({})).toContain("recognition NO");
  });

  /**
   * The Quest case as documented, which is the one this exists to confirm or
   * refute on the actual device: speaks, does not listen, but can record — so a
   * press-to-talk button is possible and needs something to transcribe with.
   */
  it("describes a browser that can speak and record but not listen", () => {
    const note = voiceReport({
      speechSynthesis: { getVoices: () => [{ name: "one" }, { name: "two" }] },
      SpeechSynthesisUtterance: class {},
      MediaRecorder: recorder,
      navigator: { mediaDevices: {} },
    });
    expect(note).toContain("recognition NO");
    expect(note).toContain("synthesis yes (2 voices)");
    expect(note).toContain("microphone yes");
    expect(note).toContain("audio/webm;codecs=opus");
  });

  it("says voices are unknown rather than zero when asking throws", () => {
    // Chromium returns an empty list until `voiceschanged`, and some builds
    // throw outright. "0 voices" would read as "it cannot speak".
    const note = voiceReport({
      speechSynthesis: { getVoices: () => { throw new Error("not yet"); } },
      SpeechSynthesisUtterance: class {},
    });
    expect(note).toContain("voices unknown");
  });

  it("does not claim a format when there is no recorder to have one", () => {
    expect(voiceReport({})).toContain("recorder no");
  });

  it("says so plainly when a recorder supports nothing we asked about", () => {
    expect(voiceReport({ MediaRecorder: { isTypeSupported: () => false } })).toContain("yes, no known format");
  });
});
