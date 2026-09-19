/**
 * Buying permission to make a sound, once, with the first tap somebody makes.
 *
 * WHY THIS EXISTS. Baiwei, on a Quest 2, in a room that was audibly speaking to
 * everybody else: "I still cannot hear your voices in my headset." The box had
 * rendered the WAV, it was the right length and not silent — three of us
 * checked all three — and `audio.play()` was refused, because a browser will
 * not play sound a person never asked for. The fallback was the browser's own
 * synthesiser, which Quest does not have, so both paths ended and the page
 * believed it had spoken.
 *
 * said-aloud.ts now SAYS so when that happens. This is the other half: not
 * explaining the silence more clearly, but not being silent.
 *
 * THE TRICK, AND IT IS THE STANDARD ONE. A gesture grants a page the right to
 * play audio, and the grant outlives the gesture. So the first time anybody
 * taps, clicks or presses a key we play a fraction of a second of silence and
 * throw it away. Nothing is heard. Every line after it is allowed.
 *
 * ONE-SHOT AND SELF-REMOVING. The listeners come off as soon as they have done
 * their job, so this costs one no-op handler per event type for as long as it
 * takes somebody to touch something, and nothing at all afterwards.
 *
 * WHAT THIS IS NOT: a guarantee. A device can still refuse for reasons of its
 * own — a muted headset, a page that never gets a gesture because the wearer is
 * only listening. That is why the failure message stayed. NOT VERIFIED IN A
 * HEADSET: the policy this works around is per-device and cannot be reproduced
 * in a test, so the unit tests below cover the mechanism and baiwei's Quest is
 * the only thing that can confirm the effect.
 */

/** The shortest legal WAV: a RIFF header and a single silent 8-bit sample. */
const SILENCE =
  "data:audio/wav;base64,UklGRiUAAABXQVZFZm10IBAAAAABAAEAgD4AAIA+AAABAAgAZGF0YQEAAACA";

/** The parts of an audio element this needs, so a test can hand it a fake. */
export type Primeable = {
  play(): Promise<void> | void;
  volume: number;
  muted?: boolean;
};

type Target = {
  addEventListener(type: string, listener: () => void, options?: unknown): void;
  removeEventListener(type: string, listener: () => void, options?: unknown): void;
};

/**
 * THESE THREE, because a headset controller reports as a pointer, a keyboard
 * as a key, and a plain click as neither on some browsers. Any of them is a
 * person doing something, which is all the policy asks for.
 */
const GESTURES = ["pointerdown", "keydown", "touchstart"] as const;

let armed = false;

/** For tests, which must not inherit a flag set by the test before them. */
export const resetAudioUnlockForTests = (): void => {
  armed = false;
};

export function primeAudioOnFirstGesture(options?: {
  on?: Target;
  makeAudio?: (url: string) => Primeable;
}): void {
  // ALREADY ARMED IS NOT AN ERROR. readAloud calls this on every line so that
  // nothing has to remember to set it up at boot; all but the first are no-ops.
  if (armed) return;
  const target = options?.on ?? (globalThis as unknown as Target);
  if (typeof target?.addEventListener !== "function") return;
  armed = true;

  const make =
    options?.makeAudio ??
    ((url: string) => new (globalThis as unknown as { Audio: new (src: string) => Primeable }).Audio(url));

  const release = () => {
    for (const gesture of GESTURES) target.removeEventListener(gesture, unlock);
  };

  const unlock = () => {
    release();
    try {
      const primer = make(SILENCE);
      primer.volume = 0;
      // Muted as well as silent: a browser that ignores volume on a primer
      // should still not click at somebody wearing a headset.
      if ("muted" in primer) primer.muted = true;
      const started = primer.play();
      // A refusal here is not worth reporting. The tap that would have fixed it
      // is the one we just used, and the line itself still says what happened.
      if (started && typeof started.then === "function") void started.catch(() => {});
    } catch {
      // Same: this is an attempt to buy permission, not a thing anybody asked for.
    }
  };

  for (const gesture of GESTURES) target.addEventListener(gesture, unlock);
}
