import { TRANSCRIBE_RATE, encodeWav, loudness, resampleTo, toMono } from "./wav";

/**
 * Press to speak, on a headset whose browser cannot listen.
 *
 * Nikk, in a Quest: "we can do the same as we are doing on AURA, where you push
 * a button to begin speech to text... lets try to get a way to SPEAK to agents,
 * that is pretty key". The Aura's browser has Web Speech recognition and this
 * one does not, so the same button has to do the work itself: record, convert,
 * and ask the server for the words.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: send anything anywhere on its own. It hands
 * back TEXT, into the same review draft the keyboard fills, and somebody still
 * presses send. A transcript is a guess, and a guess published under your name
 * in the group chat is not something to do automatically — that rule is older
 * than this file and it survives the new path.
 *
 * THE CONVERSION IS IN THE PAGE because the browser already has a complete
 * audio decoder, and doing it here leaves the server needing one binary instead
 * of a media toolchain. See wav.ts.
 *
 * WHAT CANNOT BE TESTED HERE is exactly the part that touches a microphone and
 * an `AudioContext`, so the pure arithmetic lives in wav.ts with its own tests
 * and this file stays a thin arrangement of browser objects.
 */

/** Below this, the microphone heard nothing worth sending to be transcribed. */
export const QUIET = 0.004;

export type SayRecorder = {
  /** Begin recording. Rejects if there is no microphone or permission is refused. */
  start(): Promise<void>;
  /** Stop, convert, and ask for the words. Returns "" when nothing was heard. */
  finish(): Promise<string>;
  /** Stop and throw the recording away without transcribing it. */
  cancel(): void;
  recording(): boolean;
  dispose(): void;
};

type Media = {
  mediaDevices?: { getUserMedia(constraints: { audio: boolean }): Promise<MediaStream> };
};

/** The recorder's own format, best first: opus in webm is the smallest. */
const WANTED = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

function bestFormat(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return WANTED.find((type) => {
    try {
      return MediaRecorder.isTypeSupported(type);
    } catch {
      return false;
    }
  });
}

export function createSayRecorder(options: {
  /** Ask the server to write the recording down. Replaced in tests. */
  transcribe?: (wav: Blob) => Promise<string>;
  /** Told what is happening, for the status line in the room. */
  onPhase?: (phase: "idle" | "recording" | "writing") => void;
  /** Builds the recorder. Replaced in tests, where there is no MediaRecorder. */
  makeRecorder?: (stream: MediaStream, mimeType: string) => MediaRecorder;
  onTrouble?: (message: string) => void;
  scope?: Media;
}): SayRecorder {
  const scope = options.scope ?? (navigator as Media);
  const transcribe = options.transcribe ?? postForWords;
  const makeRecorder = options.makeRecorder ?? ((stream, mimeType) => new MediaRecorder(stream, { mimeType }));
  const phase = (next: "idle" | "recording" | "writing") => options.onPhase?.(next);

  let recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null;
  let chunks: Blob[] = [];
  let stopped: (() => void) | null = null;
  let cancelled = false;

  /** Let go of the microphone. A held microphone is a light on somebody's headset. */
  const release = () => {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
    recorder = null;
  };

  return {
    recording: () => recorder?.state === "recording",

    start: async () => {
      if (recorder) return;
      cancelled = false;
      chunks = [];
      if (!scope.mediaDevices?.getUserMedia) {
        throw new Error("This browser will not give a page a microphone.");
      }
      const format = bestFormat();
      if (!format) throw new Error("This browser cannot record audio.");
      stream = await scope.mediaDevices.getUserMedia({ audio: true });
      /**
       * A MICROPHONE OPENED AND NEVER CLOSED is the bug this guards.
       *
       * The first version assigned the stream and then built the recorder. If
       * building it threw — an unsupported mime type accepted by
       * `isTypeSupported` and refused by the constructor, which happens — the
       * stream stayed live: `release` is only reached through finish, cancel
       * and dispose, and none of those is offered when the room believes
       * nothing is recording. The wearer would have been left with a
       * microphone light on and no control that turns it off, and the next
       * press would have opened a second one and leaked the first.
       */
      try {
        const built = makeRecorder(stream, format);
        built.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        built.onstop = () => stopped?.();
        built.start();
        recorder = built;
      } catch (error) {
        release();
        throw error;
      }
      phase("recording");
    },

    finish: async () => {
      const active = recorder;
      if (!active) return "";
      // `stop` is asynchronous and the last chunk arrives after it, so the whole
      // recording exists only once `onstop` has fired.
      await new Promise<void>((resolve) => {
        stopped = resolve;
        if (active.state === "inactive") resolve();
        else active.stop();
      });
      stopped = null;
      release();
      if (cancelled) return "";
      phase("writing");
      try {
        const recorded = new Blob(chunks, { type: chunks[0]?.type || "audio/webm" });
        chunks = [];
        if (recorded.size === 0) {
          phase("idle");
          return "";
        }
        const wav = await toWav(recorded);
        if (!wav) {
          phase("idle");
          options.onTrouble?.("I did not hear anything. Nothing was sent.");
          return "";
        }
        const words = await transcribe(wav);
        phase("idle");
        return words;
      } catch (error) {
        phase("idle");
        options.onTrouble?.(error instanceof Error ? error.message : "The recording could not be written down.");
        return "";
      }
    },

    cancel: () => {
      cancelled = true;
      chunks = [];
      if (recorder?.state === "recording") recorder.stop();
      stopped?.();
      stopped = null;
      release();
      phase("idle");
    },

    dispose: () => {
      cancelled = true;
      if (recorder?.state === "recording") recorder.stop();
      release();
    },
  };
}

/** Decode whatever was recorded, mix to mono, resample, and wrap as WAV. */
async function toWav(recorded: Blob): Promise<Blob | null> {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await recorded.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    const mono = resampleTo(toMono(channels), decoded.sampleRate, TRANSCRIBE_RATE);
    // Silence is not worth a round trip, a core on the server, or the wait.
    if (loudness(mono) < QUIET) return null;
    return new Blob([encodeWav(mono, TRANSCRIBE_RATE)], { type: "audio/wav" });
  } finally {
    await context.close().catch(() => {});
  }
}

/**
 * Whether the server can write speech down, asked once.
 *
 * The button must not replace the keyboard with a recorder that can only
 * apologise. False on any error, including being signed out: a room that
 * cannot answer cannot transcribe either.
 */
export async function canTranscribe(): Promise<boolean> {
  try {
    const { base } = await import("../router");
    const response = await fetch(`${base}/bff/space/transcribe`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return false;
    const body = (await response.json()) as { available?: boolean };
    return body.available === true;
  } catch {
    return false;
  }
}

/** Ask the server for the words. Its answer is text, never audio. */
async function postForWords(wav: Blob): Promise<string> {
  const { base } = await import("../router");
  const response = await fetch(`${base}/bff/space/transcribe`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "audio/wav" },
    body: wav,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? "The words could not be written down. Nothing was sent.");
  }
  const body = (await response.json()) as { text?: string };
  return (body.text ?? "").trim();
}
