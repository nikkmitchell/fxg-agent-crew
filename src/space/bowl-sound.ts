/**
 * The sound of a singing bowl, made in the browser.
 *
 * A REAL BOWL'S SOUND, roughly: a handful of partials that are NOT whole
 * multiples of the note (that is what makes it a bowl and not a bell or a
 * string), each one a pair of tones a fraction of a hertz apart so it slowly
 * beats ("wah-wah"), the high ones fading much faster than the low one, and a
 * short bright knock at the start from the striker. Circling the rim excites
 * the lowest partial without the knock and it swells rather than strikes.
 *
 * Nothing downloaded, no licence; the same shared AudioContext as the orb
 * (breath-sound.ts).
 */
import { audio } from "./breath-sound";

/** Partials as multiples of the note, their loudness, and how long each rings (s). */
export const BOWL_VOICE = [
  { ratio: 1, level: 1, decay: 14 },
  { ratio: 2.71, level: 0.55, decay: 8 },
  { ratio: 5.15, level: 0.28, decay: 4 },
  { ratio: 8.43, level: 0.12, decay: 2 },
] as const;

/** How far apart each partial's two tones are, in hertz: the slow beating of a real bowl. */
export const BEAT_HZ = 0.9;

function partial(ctx: AudioContext, out: AudioNode, frequency: number, peak: number, decay: number, attack: number): void {
  const at = ctx.currentTime;
  for (const offset of [-BEAT_HZ / 2, BEAT_HZ / 2]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(frequency + offset, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak / 2), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + attack + decay + 0.1);
  }
}

/** Where the bowls' sound goes, made once: a little room reverb would be nice, but a soft limiter is essential. */
let bus: AudioNode | null = null;
function output(ctx: AudioContext): AudioNode {
  if (bus) return bus;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -12;
  limiter.ratio.value = 6;
  limiter.connect(ctx.destination);
  bus = limiter;
  return bus;
}

/** Strike a bowl: `strength` 0.1 to 1, `distance` from the listener in metres for a gentle fall-off. */
export function ringBowl(note: number, strength: number, distance = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const loud = 0.16 * strength * Math.min(1, 1.6 / Math.max(0.6, distance));
  const out = output(ctx);
  for (const voice of BOWL_VOICE) partial(ctx, out, note * voice.ratio, loud * voice.level, voice.decay * (0.6 + strength * 0.4), 0.004);
  // THE KNOCK: a very short burst of filtered noise, brighter for a harder strike.
  const length = Math.floor(ctx.sampleRate * 0.03);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const knock = ctx.createBufferSource();
  knock.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = note * (4 + strength * 6);
  filter.Q.value = 2;
  const gain = ctx.createGain();
  gain.gain.value = loud * 0.5;
  knock.connect(filter).connect(gain).connect(out);
  knock.start();
}

/**
 * A moment of rim singing: the lowest partials swell in and hold a little,
 * and each call keeps it going. Called every few hundred milliseconds while a
 * finger circles the rim.
 */
export function singBowl(note: number, level: number, distance = 1): void {
  const ctx = audio();
  if (!ctx) return;
  const loud = 0.09 * Math.min(1, level) * Math.min(1, 1.6 / Math.max(0.6, distance));
  const out = output(ctx);
  partial(ctx, out, note, loud, 2.5, 0.35);
  partial(ctx, out, note * BOWL_VOICE[1].ratio, loud * 0.35, 1.5, 0.35);
}
