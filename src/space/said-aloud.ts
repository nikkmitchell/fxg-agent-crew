import { base } from "../router";
import { speakSay, type SpeechFailure, type SpeechOutput, type SpeechPhase } from "./speech";

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
 * THE FALLBACK IS NOT A FORMALITY. A box with no engine answers 501, a busy one
 * 503, and a Quest may refuse to play audio it was not asked for by a tap. In
 * every one of those the line is still read by the browser exactly as before,
 * and the words are in the transcript regardless: speech is an enhancement over
 * text, never a replacement for it.
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
  /** The box's rendering of this line, or null when it has none. Injected for tests. */
  fetchSaid?: (utteranceId: number) => Promise<string | null>;
  /** Injected for tests; the real one is an Audio element. */
  makeAudio?: (url: string) => Playable;
};

/**
 * Ask the box for this line as sound.
 *
 * Anything other than a 200 means "not from here, not now" and is not an error
 * worth showing anybody: 501 is a box with no engine, 503 is one already
 * speaking or one whose engine just failed, and both leave the words in the
 * room in writing. The object URL is revoked when playback ends.
 */
export const fetchSaidAloud = async (utteranceId: number): Promise<string | null> => {
  try {
    const response = await fetch(`${base}/bff/space/utterances/${utteranceId}/audio`, {
      credentials: "include",
    });
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

  const line = say.trim();
  if (!line || utteranceId === null) {
    browser("no-audio");
  } else {
    void fetchSaid(utteranceId)
      .then((url) => {
        if (cancelled) return;
        if (!url) return browser("no-audio");
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
      .catch(() => browser("no-audio"));
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
