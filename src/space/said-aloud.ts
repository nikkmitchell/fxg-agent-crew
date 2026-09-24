import { base } from "../router";
import { speakSay, type SpeechFailure, type SpeechOutput, type SpeechPhase } from "./speech";
import { primeAudioOnFirstGesture } from "./audio-unlock";

/**
 * Hearing a line in the speaker's OWN voice, made on the box, with the
 * browser's synthesiser as the fallback.
 *
 * Nikk asked for "open source tts that has actual nice voices, that can be used
 * by each agent, so they can also choose a voice". The browser's voices are
 * whatever that device happens to ship, so every agent sounds like the same
 * robot on one machine and a different robot on the next — an agent's chosen
 * voice was a fact the listener never heard.
 *
 * THE ROBOT IS FOR A BOX THAT HAS NO VOICE AT ALL — nothing else. It used to
 * read any line the box could not serve, and "the box is busy" was the common
 * one: every agent that spoke while another's line was being made was heard in
 * the browser's robot instead of its own voice. Nikk (2026-09-24): "we don't
 * want them to fall back to robot voices, we want to wait for them to get their
 * actual voice". The box now queues lines instead of refusing them (see
 * server/space/speak.ts), and this plays them one after another (queueAloud).
 *
 * So the robot reads a line only when the box has NO engine (501), or this
 * device cannot play what it made. A line the box FAILED to make is not read
 * at all: the room says so, and the words are in the transcript regardless —
 * speech is an enhancement over text, never a replacement for it.
 *
 * ONLY A ROOM UTTERANCE HAS AUDIO. Chat messages are read by the browser: they
 * are WebHarness's, they have no utterance id here, and the box has never seen
 * them.
 */

/** The parts of an audio element this needs, so a test can hand it a fake. */
export type Playable = {
  play(): Promise<void> | void;
  pause(): void;
  volume: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
};

export type ReadAloudOptions = {
  /** The room utterance being read, or null for anything the box has not heard of. */
  utteranceId: number | null;
  say: string;
  /** Who said it, for the fallback's per-agent pitch. See agent-voice.ts. */
  speaker?: string;
  /** How loud, from 0 to 1 — quieter for a speaker further away. */
  volume?: number;
  onPhase: (phase: SpeechPhase) => void;
  onFailure: (failure: SpeechFailure) => void;
  /**
   * The box's rendering of this line: a URL to play, NO_ENGINE when the box
   * cannot speak at all, or null when it failed to make this one. Injected for
   * tests.
   */
  fetchSaid?: (utteranceId: number) => Promise<string | typeof NO_ENGINE | null>;
  /** Injected for tests; the real one is an Audio element. */
  makeAudio?: (url: string) => Playable;
};

/** The box has no speech engine: the browser's voice is the only one there is. */
export const NO_ENGINE = Symbol("this box has no speech engine");

/**
 * Ask the box for this line as sound.
 *
 * 501 is a box with no engine, and the browser's voice is the only one there
 * is. Anything else that is not a 200 means the box tried and FAILED — no
 * longer "busy", because it now queues — and the words are in the room in
 * writing. The object URL is revoked when playback ends.
 *
 * THIS CAN TAKE A WHILE, on purpose: a line said while others were being made
 * waits its turn on the box, a few seconds each, rather than coming back as a
 * refusal the page used to read in the robot's voice.
 */
export const fetchSaidAloud = async (utteranceId: number): Promise<string | typeof NO_ENGINE | null> => {
  try {
    const response = await fetch(`${base}/bff/space/utterances/${utteranceId}/audio`, {
      credentials: "include",
    });
    if (response.status === 501) return NO_ENGINE;
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
};

const defaultAudio = (url: string): Playable => new Audio(url) as unknown as Playable;

/**
 * Read a line aloud, preferring the box.
 *
 * Returns immediately, like `speakSay`, because the caller is a React effect
 * that has to hand back a cancel synchronously. Whatever is playing when
 * `cancel` arrives is stopped: the fetch's result is dropped if it has not
 * started, the audio is paused if it has, and the fallback is cancelled if that
 * is what ended up speaking.
 */
export function readAloud(options: ReadAloudOptions): SpeechOutput {
  const { utteranceId, say, speaker, volume, onPhase, onFailure } = options;
  const fetchSaid = options.fetchSaid ?? fetchSaidAloud;
  const makeAudio = options.makeAudio ?? defaultAudio;

  /**
   * ARMED HERE RATHER THAN AT BOOT, so nothing has to remember to set it up and
   * no surface can forget. Every call after the first is a no-op. It buys the
   * right to play sound on the NEXT tap, so it does not rescue this line — the
   * refusal message still has to exist, and does.
   */
  primeAudioOnFirstGesture();

  let cancelled = false;
  let spoken: SpeechOutput | null = null;
  let playing: Playable | null = null;

  /**
   * THE FALLBACK CAN ITSELF FAIL, AND IT USED TO DO SO IN SILENCE.
   *
   * `speakSay` returns null when the device has no speech synthesis — no
   * onFailure, no phase change, nothing. Quest Browser is exactly that device.
   * So a headset that refused to autoplay the box's WAV dropped into a
   * fallback that could not speak either, and the room simply went quiet with
   * no reason given anywhere.
   *
   * Baiwei, on a Quest 2, into a room that was speaking: "I still cannot hear
   * your voices in my headset." Nothing on the page could have told them why,
   * because nothing knew it had failed.
   *
   * A silence with a reason is a different thing from a silence.
   */
  const browser = (why: "refused" | "no-audio") => {
    if (cancelled) return;
    spoken = speakSay({ say, speaker, volume, onPhase, onFailure });
    if (spoken) return;
    onPhase("idle");
    onFailure(
      why === "refused"
        ? {
            code: "autoplay-refused",
            message:
              "This headset would not play sound on its own. Tap once in the room and the next line will be spoken.",
          }
        : {
            code: "no-voice-here",
            message: "Nothing on this device can speak that line. Its full text is in the transcript.",
          },
    );
  };

  /** The box tried and failed to make this line. Said so; NOT read by the robot. */
  const unvoiced = () => {
    if (cancelled) return;
    onPhase("idle");
    onFailure({
      code: "not-voiced",
      message: "That line could not be said in its speaker's voice. Its full text is in the room.",
    });
  };

  const line = say.trim();
  if (!line || utteranceId === null) {
    browser("no-audio");
  } else {
    void fetchSaid(utteranceId)
      .then((url) => {
        if (cancelled) return;
        if (url === NO_ENGINE) return browser("no-audio");
        if (!url) return unvoiced();
        const audio = makeAudio(url);
        playing = audio;
        if (volume !== undefined) audio.volume = Math.max(0, Math.min(1, volume));
        audio.onended = () => {
          URL.revokeObjectURL(url);
          playing = null;
          if (!cancelled) onPhase("idle");
        };
        audio.onerror = () => {
          // The box made a sound this device will not play. The browser can
          // still say the words, and that is better than silence with no reason.
          URL.revokeObjectURL(url);
          playing = null;
          browser("no-audio");
        };
        onPhase("speaking");
        const started = audio.play();
        if (started && typeof started.then === "function") {
          void started.catch(() => {
            // Autoplay refused, most often in a headset that wants a tap first.
            URL.revokeObjectURL(url);
            playing = null;
            browser("refused");
          });
        }
      })
      .catch(() => unvoiced());
  }

  return {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      spoken?.cancel();
      if (playing) {
        playing.onended = null;
        playing.onerror = null;
        playing.pause();
        playing = null;
      }
      onPhase("idle");
    },
  };
}

/**
 * ONE LINE AFTER ANOTHER, NEVER OVER EACH OTHER, NEVER CUT OFF.
 *
 * Every surface used to CANCEL the line that was playing when a new one
 * arrived. That kept two voices from talking at once by interrupting the first
 * mid-sentence — and when the box was busy, the second was the robot. Nikk:
 * "we also don't want them speaking at the same time, so it's very fine to have
 * it wait until the previous one's finished before it begins the next one".
 *
 * So a line waits here for the one before it to end, then plays in its own
 * voice. Its own `cancel` takes it out of the line, or stops it if it is the
 * one playing; nothing else is touched.
 *
 * ONE QUEUE FOR THE PAGE, not one per surface: the window panel and the
 * headset room can both be mounted, and two queues would be two voices again.
 */
type Turn = {
  options: ReadAloudOptions;
  output: SpeechOutput | null;
  cancelled: boolean;
  finish: () => void;
};

const waitingLines: Turn[] = [];
let playingLine: Turn | null = null;

/**
 * A line that never reports finishing must not silence every line after it —
 * a browser whose synthesiser drops its `end` event, say. Longer than any line
 * plus its wait on the box.
 */
export const LONGEST_TURN_MS = 90_000;

const nextLine = () => {
  if (playingLine) return;
  const turn = waitingLines.shift();
  if (!turn) return;
  playingLine = turn;
  let finished = false;
  const guard = setTimeout(() => {
    turn.output?.cancel();
    finish();
  }, LONGEST_TURN_MS);
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(guard);
    if (playingLine === turn) playingLine = null;
    nextLine();
  };
  turn.finish = finish;
  turn.output = readAloud({
    ...turn.options,
    onPhase: (phase) => {
      turn.options.onPhase(phase);
      if (phase === "idle") finish();
    },
  });
};

/** Say this line when the one before it has finished. See the note above. */
export function queueAloud(options: ReadAloudOptions): SpeechOutput {
  const turn: Turn = { options, output: null, cancelled: false, finish: () => {} };
  waitingLines.push(turn);
  nextLine();
  return {
    cancel: () => {
      if (turn.cancelled) return;
      turn.cancelled = true;
      const waiting = waitingLines.indexOf(turn);
      if (waiting >= 0) {
        waitingLines.splice(waiting, 1);
        return;
      }
      turn.output?.cancel();
      turn.finish();
    },
  };
}

/** Only for tests: forget every line, so one test's queue cannot leak into the next. */
export function clearAloudQueue(): void {
  waitingLines.length = 0;
  playingLine = null;
}
