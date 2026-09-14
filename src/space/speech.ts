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
 * One run's results with the engine's revisions folded together.
 *
 * WHY. Chromium on Android — which is what the Quest and the Aura run — does
 * not report a continuous run the way desktop Chrome does. Desktop sends each
 * phrase once, as its own result. Android sends a NEW result every time it
 * hears another word, each holding the whole phrase so far, and marks most of
 * them final. Joining them gave Nikk's messages the shape "is the / is the
 * please / is the please deploy / is the please deploy and ...", every phrase
 * repeated at every length.
 *
 * So a result that continues or corrects the one before it replaces it rather
 * than being added after it. "Continues" is a prefix match after ignoring case
 * and punctuation, which also catches a last word still being revised ("is of"
 * then "is offline"). A result that shares two or more leading words and
 * differs only in its last word counts as a correction. Anything else is a new
 * phrase — which is every result desktop Chrome sends, so desktop is unchanged.
 */
export type HeardResult = { text: string; final: boolean; confidence?: number };

const normalise = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu, " ").replace(/\s+/g, " ").trim();

function revises(earlier: string, later: string): boolean {
  const a = normalise(earlier);
  const b = normalise(later);
  if (!a || !b) return true;
  if (b.startsWith(a) || a.startsWith(b)) return true;
  const aw = a.split(" ");
  const bw = b.split(" ");
  const shared = Math.min(aw.length, bw.length) - 1;
  if (shared < 2) return false;
  for (let index = 0; index < shared; index += 1) if (aw[index] !== bw[index]) return false;
  return true;
}

export function foldRevisions(results: HeardResult[]): HeardResult[] {
  const folded: HeardResult[] = [];
  for (const result of results) {
    const text = result.text.trim();
    if (!text) continue;
    const last = folded[folded.length - 1];
    if (last && revises(last.text, text)) folded[folded.length - 1] = { ...result, text };
    else folded.push({ ...result, text });
  }
  return folded;
}

/** How long a phrase must go unchanged before it is announced to `onPhrase`. */
const PHRASE_SETTLE_MS = 900;

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
  /** Finished phrases from the run in progress, revisions folded (see foldRevisions). */
  let runFinals: string[] = [];
  /**
   * How much of each of this run's phrases `clear()` has already disposed of.
   * The engine re-sends a run's earlier phrases with every update — and on
   * Android keeps extending the last one — so without this, words that were
   * posted and cleared would reappear on the next result.
   */
  let cleared: string[] = [];
  let interim = "";
  const confidences: number[] = [];
  let runConfidences: number[] = [];
  /** What `onPhrase` has been told of each of this run's phrases so far. */
  let announced: string[] = [];
  let phraseTimer: unknown = null;
  let restartTimer: unknown = null;
  let failures = 0;
  let finishing: { resolve: (value: { text: string; confidence?: number }) => void; guard: unknown } | null = null;

  /** What is left of `text` once `already` has been taken off its front. */
  const beyond = (text: string, already: string | undefined) => {
    if (!already) return text;
    const a = normalise(already);
    if (!normalise(text).startsWith(a)) return "";
    // Walk the original text until as many normalised characters as `already`
    // has have gone by, so the remainder keeps its own case and punctuation.
    const taken = a.replace(/ /g, "").length;
    let seen = 0;
    let index = 0;
    while (index < text.length && seen < taken) {
      if (/[\p{L}\p{N}']/u.test(text[index])) seen += 1;
      index += 1;
    }
    return text.slice(index).replace(/^[^\p{L}\p{N}']+/u, "");
  };
  const runWords = () => runFinals.map((phrase, index) => beyond(phrase, cleared[index]));
  const words = () => [...kept, ...runWords()].map((part) => part.trim()).filter(Boolean).join(" ");
  const report = () => options.onText([words(), interim.trim()].filter(Boolean).join(" "));
  const confidence = () => {
    const all = [...confidences, ...runConfidences];
    return all.length > 0 ? all.reduce((sum, value) => sum + value, 0) / all.length : undefined;
  };

  /**
   * Tell `onPhrase` about finished words, once each.
   *
   * NOT THE MOMENT A RESULT IS MARKED FINAL. On Android "final" arrives with
   * every word, and a mode that posts each phrase would post "hey", then "hey
   * so", then "hey so I thought". A phrase is announced when something new has
   * started after it, when it has gone unchanged for a moment, or when the run
   * ends — and if the engine later extends a phrase already announced, only
   * the new words go out.
   */
  const announce = (upTo: number) => {
    if (!options.onPhrase) return;
    for (let index = 0; index < Math.min(upTo, runFinals.length); index += 1) {
      const phrase = runFinals[index];
      const fresh = beyond(phrase, announced[index]).trim();
      if (normalise(phrase).startsWith(normalise(announced[index] ?? ""))) announced[index] = phrase;
      if (!fresh) continue;
      const value = runConfidences[index];
      options.onPhrase(value !== undefined ? { text: fresh, confidence: value } : { text: fresh });
    }
  };
  const cancelPhraseTimer = () => {
    if (phraseTimer !== null) clearTimer(phraseTimer);
    phraseTimer = null;
  };

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
    // engine revises earlier phrases, and appending blindly would duplicate
    // them. Then folded, for the engines that report a phrase once per word.
    const heard: HeardResult[] = [];
    for (let index = 0; index < event.results.length; index += 1) {
      const result = event.results[index];
      const value = result?.[0]?.confidence;
      heard.push({
        text: result?.[0]?.transcript ?? "",
        final: Boolean(result?.isFinal),
        ...(typeof value === "number" && Number.isFinite(value) && value > 0 ? { confidence: value } : {}),
      });
    }
    const folded = foldRevisions(heard);
    const last = folded[folded.length - 1];
    const guess = last && !last.final ? last : null;
    const done = guess ? folded.slice(0, -1) : folded;
    runFinals = done.map((phrase) => phrase.text);
    runConfidences = done.flatMap((phrase) => (phrase.confidence !== undefined ? [phrase.confidence] : []));
    interim = guess?.text ?? "";
    failures = 0;
    report();

    // Everything before the last phrase is finished: something came after it.
    announce(done.length - 1);
    cancelPhraseTimer();
    if (options.onPhrase && done.length > 0) {
      phraseTimer = setTimer(() => {
        phraseTimer = null;
        announce(runFinals.length);
      }, PHRASE_SETTLE_MS);
    }
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
    cancelPhraseTimer();
    announce(runFinals.length);
    kept = [...kept, ...runWords()];
    confidences.push(...runConfidences);
    runFinals = [];
    runConfidences = [];
    cleared = [];
    announced = [];
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
      runConfidences = [];
      cleared = [];
      announced = [];
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
        cancelPhraseTimer();
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
      cancelPhraseTimer();
      recording = false;
      kept = [];
      runFinals = [];
      runConfidences = [];
      cleared = [];
      announced = [];
      interim = "";
      options.onRecording(false);
      if (running) recognition.abort();
      report();
    },
    clear: () => {
      kept = [];
      // Not emptied: the engine still holds them and will send them again,
      // possibly longer. Remember how much of each has been disposed of.
      cleared = [...runFinals];
      interim = "";
      confidences.length = 0;
      report();
    },
    dispose: () => {
      disposed = true;
      recording = false;
      cancelPhraseTimer();
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
