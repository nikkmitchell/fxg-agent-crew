/** Browser speech lives behind this boundary so unsupported browsers stay text-first. */
export type SpeechPhase = "idle" | "listening" | "speaking";

export type SpeechFailure = { code: string; message: string };

type RecognitionAlternative = { transcript: string; confidence?: number };
type RecognitionResult = { isFinal: boolean; length: number; [index: number]: RecognitionAlternative };
type RecognitionEvent = {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
};
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};
type RecognitionConstructor = new () => Recognition;
type Utterance = {
  text: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};
type SpeechGlobals = {
  navigator?: { language?: string };
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  speechSynthesis?: { speak(utterance: Utterance): void; cancel(): void };
  SpeechSynthesisUtterance?: new (text: string) => Utterance;
};

export const speechCapabilities = (scope: SpeechGlobals = globalThis as SpeechGlobals) => ({
  recognition: Boolean(scope.SpeechRecognition ?? scope.webkitSpeechRecognition),
  synthesis: Boolean(scope.speechSynthesis && scope.SpeechSynthesisUtterance),
});

const recognitionFailure = (code = "unknown"): SpeechFailure => {
  if (code === "not-allowed" || code === "service-not-allowed") {
    return { code, message: "Microphone access was refused. You can still type the same words." };
  }
  if (code === "no-speech") return { code, message: "I did not hear speech. Nothing was sent." };
  if (code === "audio-capture") {
    return { code, message: "No working microphone was available. You can still type instead." };
  }
  if (code === "network") {
    return { code, message: "Speech recognition lost its service. Nothing was sent." };
  }
  return { code, message: "Speech recognition stopped before it produced text. Nothing was sent." };
};

export type SpeechInput = { start(): void; stop(): void; dispose(): void };

export function createSpeechInput(options: {
  scope?: SpeechGlobals;
  onPhase: (phase: SpeechPhase) => void;
  onInterim: (text: string) => void;
  onFinal: (result: { text: string; confidence?: number }) => void;
  onFailure: (failure: SpeechFailure) => void;
}): SpeechInput | null {
  const scope = options.scope ?? (globalThis as SpeechGlobals);
  const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Constructor) return null;

  const recognition = new Constructor();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = scope.navigator?.language ?? "en-US";
  let disposed = false;
  let finalDelivered = false;

  recognition.onstart = () => {
    finalDelivered = false;
    options.onPhase("listening");
  };
  recognition.onresult = (event) => {
    let interim = "";
    let final = "";
    const confidences: number[] = [];
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript ?? "";
      if (result?.isFinal) {
        final += transcript;
        /**
         * A ZERO IS "NOT REPORTED", NOT "CERTAINLY WRONG".
         *
         * Every utterance Nikk spoke through a Quest stored confidence 0, and
         * the transcript duly displayed "VOICE 0%" — which reads as the machine
         * declaring itself certain the words are wrong. It was declaring
         * nothing: several Web Speech implementations return 0 on final results
         * rather than a figure, and an engine that genuinely had no confidence
         * would not be handing the result over as final.
         *
         * So a zero is dropped and the utterance carries no confidence at all,
         * which the transcript already renders as a plain "VOICE". Saying
         * nothing is the honest answer when nothing was said to us.
         */
        const confidence = result[0]?.confidence;
        if (typeof confidence === "number" && Number.isFinite(confidence) && confidence > 0) {
          confidences.push(confidence);
        }
      } else {
        interim += transcript;
      }
    }
    options.onInterim(interim.trim());
    const complete = final.trim();
    if (!complete) return;
    finalDelivered = true;
    options.onInterim("");
    options.onFinal({
      text: complete,
      ...(confidences.length > 0
        ? { confidence: confidences.reduce((sum, value) => sum + value, 0) / confidences.length }
        : {}),
    });
    options.onPhase("idle");
  };
  recognition.onerror = (event) => {
    if (disposed) return;
    finalDelivered = false;
    options.onInterim("");
    options.onFailure(recognitionFailure(event.error));
    options.onPhase("idle");
  };
  recognition.onend = () => {
    if (!disposed && !finalDelivered) options.onPhase("idle");
  };

  return {
    start: () => {
      if (disposed) return;
      try {
        recognition.start();
      } catch {
        options.onFailure(recognitionFailure("start-failed"));
        options.onPhase("idle");
      }
    },
    stop: () => { if (!disposed) recognition.stop(); },
    dispose: () => {
      disposed = true;
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    },
  };
}

/**
 * Recording that keeps going until you say stop.
 *
 * WHY THIS EXISTS. Recognition ran with `continuous = false`, so the browser
 * ended it at the first pause, and nothing started it again. Nikk, from a
 * headset: "once my volume goes low the recording stops can we not have that
 * happen can we have it just steadily record... after they push the button it
 * stays on audio transcribe and if it auto disconnects just have it reconnect
 * immediately until they actually tap the button again."
 *
 * There was a second fault under the first. Each finished phrase REPLACED what
 * had been heard, so the prompt "speak again to add to it" was not true:
 * speaking again after a pause threw the earlier words away.
 *
 * So a session is the person's intent, not the browser's. It begins on
 * `start()` and ends only on `finish()` or `cancel()`. Whenever the recogniser
 * ends on its own — a pause, a "no-speech" timeout, a network blip — it is
 * started again straight away, and every final phrase from every run is kept
 * in order. Only faults a restart cannot fix end a session: microphone access
 * refused, or no working microphone at all.
 *
 * `finish()` WAITS FOR THE LAST WORDS. Stopping a recogniser delivers its final
 * result a moment later, and the old press-to-send posted the transcript before
 * that arrived, which could drop the last few words. `finish()` resolves only
 * once the recogniser has actually ended, with a short safety limit for engines
 * that never say they have.
 */
export type SteadyRecorder = {
  /** Begin a session. Clears anything from a previous one. */
  start(): void;
  /** End the session and resolve with everything heard, last words included. */
  finish(): Promise<{ text: string; confidence?: number }>;
  /** End the session and throw the words away. */
  cancel(): void;
  /** Forget what has been heard so far without ending the session. */
  clear(): void;
  dispose(): void;
};

/** Faults that another start() cannot fix, so the session ends. */
const FATAL = new Set(["not-allowed", "service-not-allowed", "audio-capture"]);

export function createSteadyRecorder(options: {
  scope?: SpeechGlobals;
  /** Everything heard in this session so far, with the words still being guessed at the end. */
  onText: (text: string) => void;
  /** Whether a session is active — the person's intent, not whether the browser is mid-phrase. */
  onRecording: (recording: boolean) => void;
  /** Each finished phrase as it lands, for modes that post as they go. */
  onPhrase?: (phrase: { text: string; confidence?: number }) => void;
  onFailure: (failure: SpeechFailure) => void;
  /** How long to wait before starting again after the browser ends a run. */
  restartDelayMs?: number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): SteadyRecorder | null {
  const scope = options.scope ?? (globalThis as SpeechGlobals);
  const Constructor = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  if (!Constructor) return null;
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const restartDelay = options.restartDelayMs ?? 150;

  const recognition = new Constructor();
  // Continuous where the engine supports it, which makes a pause far less
  // likely to end a run at all. The restart below covers the engines that end
  // it anyway, and every engine eventually does.
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = scope.navigator?.language ?? "en-US";

  let recording = false;
  let running = false;
  let disposed = false;
  /** Finished phrases from runs that have ended, in order. */
  let kept: string[] = [];
  /** Finished phrases from the run in progress. */
  let runFinals: string[] = [];
  /**
   * How many of this run's phrases `clear()` has already disposed of. The
   * engine re-sends a run's earlier phrases with every update, so without this
   * words that were posted and cleared would reappear on the next result.
   */
  let skip = 0;
  let interim = "";
  const confidences: number[] = [];
  let restartTimer: unknown = null;
  let failures = 0;
  let finishing: { resolve: (value: { text: string; confidence?: number }) => void; guard: unknown } | null = null;

  const words = () => [...kept, ...runFinals.slice(skip)].map((part) => part.trim()).filter(Boolean).join(" ");
  const report = () => options.onText([words(), interim.trim()].filter(Boolean).join(" "));
  const confidence = () =>
    confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : undefined;

  const settle = () => {
    if (!finishing) return;
    const done = finishing;
    finishing = null;
    clearTimer(done.guard);
    // A phrase the engine never marked final is still words the person said;
    // keeping it beats sending a sentence with its end missing.
    const text = [words(), interim.trim()].filter(Boolean).join(" ");
    interim = "";
    const value = confidence();
    done.resolve(value === undefined ? { text } : { text, confidence: value });
  };

  const launch = () => {
    if (disposed || !recording || running) return;
    try {
      recognition.start();
      running = true;
    } catch {
      // Started too soon after the last run ended; try again shortly rather
      // than giving up on a session the person has not ended.
      failures += 1;
      restartTimer = setTimer(launch, Math.min(2000, restartDelay * 2 ** Math.min(failures, 4)));
    }
  };

  recognition.onstart = () => {
    running = true;
  };

  recognition.onresult = (event) => {
    // The results of THIS run, rebuilt whole each time: in continuous mode the
    // engine revises earlier phrases, and appending blindly would duplicate them.
    const finals: string[] = [];
    let guess = "";
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const transcript = result?.[0]?.transcript ?? "";
      if (result?.isFinal) {
        finals.push(transcript);
        if (index >= event.resultIndex) {
          const value = result[0]?.confidence;
          if (typeof value === "number" && Number.isFinite(value) && value > 0) confidences.push(value);
          options.onPhrase?.(
            typeof value === "number" && value > 0 ? { text: transcript.trim(), confidence: value } : { text: transcript.trim() },
          );
        }
      } else {
        guess += transcript;
      }
    }
    runFinals = finals;
    interim = guess;
    failures = 0;
    report();
  };

  recognition.onerror = (event) => {
    if (disposed) return;
    const code = event.error ?? "unknown";
    if (FATAL.has(code)) {
      recording = false;
      options.onFailure(recognitionFailure(code));
      options.onRecording(false);
    }
    // Everything else — a pause timing out, a dropped connection, an abort —
    // is followed by onend, which starts the next run.
  };

  recognition.onend = () => {
    running = false;
    if (disposed) return;
    kept = [...kept, ...runFinals.slice(skip)];
    runFinals = [];
    skip = 0;
    if (finishing || !recording) {
      settle();
      return;
    }
    // THE RESTART. The browser ended a run the person did not end.
    restartTimer = setTimer(launch, restartDelay);
  };

  return {
    start: () => {
      if (disposed || recording) return;
      kept = [];
      runFinals = [];
      skip = 0;
      interim = "";
      confidences.length = 0;
      failures = 0;
      recording = true;
      options.onRecording(true);
      report();
      launch();
    },
    finish: () =>
      new Promise((resolve) => {
        if (disposed) {
          resolve({ text: "" });
          return;
        }
        if (restartTimer !== null) clearTimer(restartTimer);
        restartTimer = null;
        const wasRecording = recording;
        recording = false;
        options.onRecording(false);
        finishing = {
          resolve,
          // Some engines never fire onend after stop(). Two seconds is long
          // enough for a final result to arrive and short enough not to feel
          // like the press was ignored.
          guard: setTimer(settle, 2000),
        };
        if (wasRecording && running) {
          try {
            recognition.stop();
          } catch {
            settle();
          }
        } else {
          settle();
        }
      }),
    cancel: () => {
      if (restartTimer !== null) clearTimer(restartTimer);
      restartTimer = null;
      recording = false;
      kept = [];
      runFinals = [];
      skip = 0;
      interim = "";
      options.onRecording(false);
      if (running) recognition.abort();
      report();
    },
    clear: () => {
      kept = [];
      // Not emptied: the engine still holds them and will send them again.
      skip = runFinals.length;
      interim = "";
      confidences.length = 0;
      report();
    },
    dispose: () => {
      disposed = true;
      recording = false;
      if (restartTimer !== null) clearTimer(restartTimer);
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    },
  };
}

export type SpeechOutput = { cancel(): void };

/** Speak only the short `say` field. `detail` never enters this function. */
export function speakSay(options: {
  say: string;
  scope?: SpeechGlobals;
  onPhase: (phase: SpeechPhase) => void;
  onFailure: (failure: SpeechFailure) => void;
}): SpeechOutput | null {
  const scope = options.scope ?? (globalThis as SpeechGlobals);
  if (!scope.speechSynthesis || !scope.SpeechSynthesisUtterance) return null;
  const say = options.say.trim();
  if (!say) return null;

  const utterance = new scope.SpeechSynthesisUtterance(say);
  let cancelled = false;
  utterance.onstart = () => { if (!cancelled) options.onPhase("speaking"); };
  utterance.onend = () => { if (!cancelled) options.onPhase("idle"); };
  utterance.onerror = (event) => {
    if (cancelled) return;
    options.onFailure({
      code: event.error ?? "synthesis-failed",
      message: "The spoken reply failed. Its complete text is still in the transcript.",
    });
    options.onPhase("idle");
  };
  try {
    scope.speechSynthesis.speak(utterance);
  } catch {
    utterance.onerror?.({ error: "synthesis-failed" });
  }
  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
      scope.speechSynthesis?.cancel();
      options.onPhase("idle");
    },
  };
}
