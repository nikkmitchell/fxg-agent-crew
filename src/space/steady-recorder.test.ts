import { describe, expect, it } from "vitest";
import { createSteadyRecorder } from "./speech";

/**
 * A recogniser that behaves the way the real ones do, so the recorder can be
 * tested without a browser: runs end on their own at a pause, a "no-speech"
 * error arrives before the end, and stopping delivers the last final result a
 * moment AFTER stop() is called.
 */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  continuous = false;
  interimResults = false;
  lang = "";
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  running = false;
  private results: { transcript: string; isFinal: boolean; confidence?: number }[] = [];

  constructor() {
    FakeRecognition.last = this;
  }
  start() {
    if (this.running) throw new Error("InvalidStateError");
    this.running = true;
    this.starts += 1;
    this.results = [];
    this.onstart?.();
  }
  stop() {}
  abort() {
    this.end();
  }
  /** The engine hearing something. */
  hear(transcript: string, isFinal: boolean, confidence?: number) {
    const last = this.results[this.results.length - 1];
    if (last && !last.isFinal) this.results[this.results.length - 1] = { transcript, isFinal, confidence };
    else this.results.push({ transcript, isFinal, confidence });
    const firstChanged = this.results.length - 1;
    const results = this.results.map((r) => Object.assign([{ transcript: r.transcript, confidence: r.confidence }], { isFinal: r.isFinal, length: 1 }));
    this.onresult?.({ resultIndex: firstChanged, results: Object.assign(results, { length: results.length }) });
  }
  /** The engine ending a run by itself, as every one does at a pause. */
  end() {
    this.running = false;
    this.onend?.();
  }
  fail(error: string) {
    this.onerror?.({ error });
  }
}

const timers = () => {
  const pending: { fn: () => void; at: number }[] = [];
  let now = 0;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const handle = { fn, at: now + ms };
      pending.push(handle);
      return handle;
    },
    clearTimer: (handle: unknown) => {
      const i = pending.indexOf(handle as never);
      if (i >= 0) pending.splice(i, 1);
    },
    advance: (ms: number) => {
      now += ms;
      for (const handle of [...pending].sort((a, b) => a.at - b.at)) {
        if (handle.at <= now) {
          pending.splice(pending.indexOf(handle), 1);
          handle.fn();
        }
      }
    },
  };
};

const make = (extra: Partial<Parameters<typeof createSteadyRecorder>[0]> = {}) => {
  const clock = timers();
  const seen = { text: "", recording: false, failures: [] as string[], phrases: [] as string[] };
  const recorder = createSteadyRecorder({
    scope: { SpeechRecognition: FakeRecognition as never, navigator: { language: "en-GB" } },
    onText: (text) => { seen.text = text; },
    onRecording: (recording) => { seen.recording = recording; },
    onPhrase: (phrase) => { seen.phrases.push(phrase.text); },
    onFailure: (failure) => { seen.failures.push(failure.code); },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...extra,
  })!;
  return { recorder, clock, seen, engine: () => FakeRecognition.last! };
};

describe("recording that keeps going until you say stop", () => {
  it("keeps recording through a pause, instead of stopping when the voice goes quiet", () => {
    // Nikk: "once my volume goes low the recording stops can we not have that
    // happen". A real engine ends its run at a pause; the session must not.
    const { recorder, clock, seen, engine } = make();
    recorder.start();
    engine().hear("so the first thing", true);
    engine().end(); // a pause: the engine stops on its own
    expect(seen.recording, "still recording as far as the person is concerned").toBe(true);
    clock.advance(200);
    expect(engine().starts, "started again straight away").toBe(2);
  });

  it("keeps the words from before the pause, rather than replacing them", () => {
    // The old recorder replaced the transcript with each phrase, so "speak
    // again to add to it" threw the earlier words away.
    const { recorder, clock, seen, engine } = make();
    recorder.start();
    engine().hear("hello Sill", true);
    engine().end();
    clock.advance(200);
    engine().hear("can you look at the board", true);
    expect(seen.text).toBe("hello Sill can you look at the board");
  });

  it("does not give up on the silence timeout the browser reports as an error", () => {
    const { recorder, clock, seen, engine } = make();
    recorder.start();
    engine().fail("no-speech");
    engine().end();
    clock.advance(200);
    expect(seen.failures).toEqual([]);
    expect(seen.recording).toBe(true);
    expect(engine().starts).toBe(2);
  });

  it("does end the session when the microphone is refused, because no restart can fix that", () => {
    const { recorder, clock, seen, engine } = make();
    recorder.start();
    engine().fail("not-allowed");
    engine().end();
    clock.advance(500);
    expect(seen.failures).toEqual(["not-allowed"]);
    expect(seen.recording).toBe(false);
    expect(engine().starts, "no restart loop against a refused microphone").toBe(1);
  });

  it("waits for the last words before handing the transcript over", async () => {
    // The old press-to-send posted before the final result arrived, which
    // could drop the last few words of a message.
    const { recorder, engine } = make();
    recorder.start();
    engine().hear("please merge this", true);
    engine().hear("once the tests", false);
    const finished = recorder.finish();
    // The engine delivers the last final result AFTER stop(), then ends.
    engine().hear("once the tests pass", true);
    engine().end();
    expect((await finished).text).toBe("please merge this once the tests pass");
  });

  it("keeps a phrase the engine never finalised, rather than losing the end of a sentence", async () => {
    const { recorder, clock, engine } = make();
    recorder.start();
    engine().hear("the end of my", false);
    const finished = recorder.finish();
    clock.advance(2100); // this engine never fires onend
    expect((await finished).text).toBe("the end of my");
  });

  it("stops restarting once you finish", async () => {
    const { recorder, clock, engine, seen } = make();
    recorder.start();
    engine().hear("done", true);
    const finished = recorder.finish();
    engine().end();
    await finished;
    clock.advance(5000);
    expect(engine().starts).toBe(1);
    expect(seen.recording).toBe(false);
  });

  it("does not show phrases again after they were posted and cleared", () => {
    // Always-on mode posts each phrase and clears; the engine then re-sends the
    // whole run with its next result.
    const { recorder, seen, engine } = make();
    recorder.start();
    engine().hear("first sentence", true);
    expect(seen.phrases).toEqual(["first sentence"]);
    recorder.clear();
    engine().hear("second sentence", true);
    expect(seen.text).toBe("second sentence");
    expect(seen.phrases, "each phrase announced once").toEqual(["first sentence", "second sentence"]);
  });

  it("backs off rather than spinning if the engine refuses to restart", () => {
    const { recorder, clock, engine } = make();
    recorder.start();
    engine().running = true; // the engine still thinks it is running
    engine().onend?.();
    engine().running = true;
    clock.advance(150); // restart attempt throws InvalidStateError
    const attempts = engine().starts;
    clock.advance(100);
    expect(engine().starts, "not retried every few milliseconds").toBe(attempts);
    engine().running = false;
    clock.advance(2000);
    expect(engine().starts).toBeGreaterThan(attempts);
  });
});
