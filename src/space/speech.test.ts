import { describe, expect, it, vi } from "vitest";
import { createSpeechInput, speakSay, speechCapabilities, type SpeechPhase } from "./speech";

class FakeRecognition {
  static latest: FakeRecognition;
  continuous = true;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  onend: (() => void) | null = null;
  start = vi.fn(() => this.onstart?.());
  stop = vi.fn(() => this.onend?.());
  abort = vi.fn();
  constructor() { FakeRecognition.latest = this; }
}

class FakeUtterance {
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

describe("browser speech boundary", () => {
  it("reports recognition and synthesis independently", () => {
    expect(speechCapabilities({})).toEqual({ recognition: false, synthesis: false });
    expect(speechCapabilities({ webkitSpeechRecognition: FakeRecognition as any })).toEqual({
      recognition: true,
      synthesis: false,
    });
  });

  it("keeps interim words local and delivers final words once", () => {
    const phases: SpeechPhase[] = [];
    const interim: string[] = [];
    const final: string[] = [];
    const input = createSpeechInput({
      scope: { navigator: { language: "en-GB" }, webkitSpeechRecognition: FakeRecognition as any },
      onPhase: (phase) => phases.push(phase),
      onInterim: (text) => interim.push(text),
      onFinal: (result) => final.push(result.text),
      onFailure: vi.fn(),
    });
    input?.start();
    FakeRecognition.latest.onresult?.({
      resultIndex: 0,
      results: Object.assign([
        Object.assign([{ transcript: "still " }], { isFinal: false }),
        Object.assign([{ transcript: "send this", confidence: 0.84 }], { isFinal: true }),
      ], { length: 2 }),
    });
    expect(FakeRecognition.latest.lang).toBe("en-GB");
    expect(interim).toEqual(["still", ""]);
    expect(final).toEqual(["send this"]);
    expect(phases).toEqual(["listening", "idle"]);
  });

  it("turns a refused microphone into a readable fallback", () => {
    const failures: string[] = [];
    const input = createSpeechInput({
      scope: { webkitSpeechRecognition: FakeRecognition as any },
      onPhase: vi.fn(), onInterim: vi.fn(), onFinal: vi.fn(),
      onFailure: (failure) => failures.push(failure.message),
    });
    input?.start();
    FakeRecognition.latest.onerror?.({ error: "not-allowed" });
    expect(failures[0]).toMatch(/still type/);
  });

  it("speaks only the supplied short text and preserves a text-first failure", () => {
    const spoken: FakeUtterance[] = [];
    const failures: string[] = [];
    const output = speakSay({
      say: "  Short answer.  ",
      scope: {
        SpeechSynthesisUtterance: FakeUtterance as any,
        speechSynthesis: { speak: (item) => spoken.push(item as FakeUtterance), cancel: vi.fn() },
      },
      onPhase: vi.fn(),
      onFailure: (failure) => failures.push(failure.message),
    });
    expect(spoken[0].text).toBe("Short answer.");
    spoken[0].onerror?.({ error: "voice-unavailable" });
    expect(failures[0]).toMatch(/still in the transcript/);
    output?.cancel();
  });

  it("aborts recognition and detaches callbacks on disposal", () => {
    const input = createSpeechInput({
      scope: { webkitSpeechRecognition: FakeRecognition as any },
      onPhase: vi.fn(), onInterim: vi.fn(), onFinal: vi.fn(), onFailure: vi.fn(),
    });
    const recognition = FakeRecognition.latest;
    input?.dispose();
    expect(recognition.abort).toHaveBeenCalledOnce();
    expect(recognition.onresult).toBeNull();
  });
});
