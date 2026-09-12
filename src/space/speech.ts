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
        const confidence = result[0]?.confidence;
        if (typeof confidence === "number" && Number.isFinite(confidence)) confidences.push(confidence);
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
    start: () => { if (!disposed) recognition.start(); },
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
  scope.speechSynthesis.speak(utterance);
  return {
    cancel: () => {
      cancelled = true;
      utterance.onstart = null;
      utterance.onend = null;
      utterance.onerror = null;
      scope.speechSynthesis?.cancel();
    },
  };
}
