/**
 * What the orb sounds like. Tones, not words: Nikk's rule is that the room never
 * falls back to the robot voice, and a spoken "breathe in" every four seconds
 * from the room's voices would fill the queue that people talk through.
 *
 * Each device plays its own tones from the shared clock, so they land together
 * without being sent anywhere. Soft sine tones with slow attacks: a cue, not an
 * alarm.
 */
import type { BreathStep } from "../../shared/meditation";

let context: AudioContext | null = null;
export function audio(): AudioContext | null {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    return context;
  } catch {
    return null;
  }
}

function tone(from: number, to: number, seconds: number, peak = 0.06): void {
  const ctx = audio();
  if (!ctx) return;
  const at = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + seconds);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + Math.min(0.6, seconds / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start(at);
  osc.stop(at + seconds + 0.05);
}

/** A phase just began: rising going in, falling going out, one low note to hold. */
export function phaseCue(phase: BreathStep["phase"], stepSeconds = Infinity): void {
  // Never longer than the step: Wim Hof breaths are a second and a half, and
  // the tones for a slow breath would pile on top of each other.
  const fit = (seconds: number) => Math.min(seconds, stepSeconds * 0.85);
  if (phase === "in") tone(220, 330, fit(1.6));
  else if (phase === "out") tone(330, 196, fit(1.8));
  else if (phase === "hold") tone(262, 262, fit(0.9), 0.03);
}

/**
 * The note to chant Om on, held for a whole out-breath.
 *
 * 136.1 Hz is the pitch commonly given for Om (the "Om frequency" of Indian
 * tuning traditions), low enough for most voices to join an octave up. A soft
 * fundamental with its octave and fifth, swelling in and fading out, so it
 * reads as a hum rather than a tone.
 */
export const OM_HZ = 136.1;
export function omDrone(seconds: number): void {
  const length = Math.max(2, seconds * 0.95);
  tone(OM_HZ, OM_HZ, length, 0.07);
  tone(OM_HZ * 2, OM_HZ * 2, length, 0.025);
  tone(OM_HZ * 3, OM_HZ * 3, length * 0.8, 0.01);
}

/** A bowl-like bell for the start and the end: two partials, a long fade. */
export function bell(): void {
  tone(528, 520, 4.5, 0.07);
  tone(1320, 1300, 3, 0.02);
}

/** Which cue, if any, a change from `before` to `after` calls for. Pure, for tests. */
export function cueFor(
  before: { state: string; phase?: BreathStep["phase"]; paused?: boolean } | null,
  after: { state: string; phase?: BreathStep["phase"]; paused?: boolean },
): "bell" | BreathStep["phase"] | null {
  if (!before) return null;
  if (after.state === "breathing" && before.state !== "breathing") return "bell";
  if (after.state === "done" && before.state === "breathing") return "bell";
  if (after.state === "breathing" && !after.paused && before.state === "breathing" && before.phase !== after.phase) return after.phase ?? null;
  return null;
}
