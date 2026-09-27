/**
 * The ember fire's sound, made in the browser: a soft bed of low rumble, the
 * random pops and ticks of burning wood, and a rising whoosh when a word is
 * given to it. Quieter the further away you stand, and silent past a few
 * metres, so the fire is something you walk up to rather than a room tone.
 */
import { audio } from "./breath-sound";

let noise: AudioBuffer | null = null;
function noiseOf(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
  noise = buffer;
  return buffer;
}

/** How loud the fire is from `distance` metres: full within a metre, gone by five. */
export function fireLevel(distance: number): number {
  if (distance <= 1) return 1;
  if (distance >= 5) return 0;
  return (5 - distance) / 4;
}

/** One pop or tick of the wood. */
export function crackle(level: number): void {
  const ctx = audio();
  if (!ctx || level <= 0) return;
  const at = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseOf(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1200 + Math.random() * 3500;
  filter.Q.value = 3 + Math.random() * 6;
  const gain = ctx.createGain();
  const peak = level * (0.04 + Math.random() * 0.1);
  const length = 0.008 + Math.random() * 0.03;
  gain.gain.setValueAtTime(peak, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at, Math.random() * 1.5, length + 0.02);
}

/** The low breathing roar under the crackle; returns a function that sets its level. */
export function rumble(): { set: (level: number) => void; stop: () => void } {
  const ctx = audio();
  if (!ctx) return { set: () => {}, stop: () => {} };
  const source = ctx.createBufferSource();
  source.buffer = noiseOf(ctx);
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 280;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start();
  return {
    set: (level) => gain.gain.setTargetAtTime(level * 0.06, ctx.currentTime, 0.4),
    stop: () => {
      gain.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => source.stop(), 1500);
    },
  };
}

/** The whoosh of a word catching: noise swelling up through a rising filter. */
export function whoosh(level: number): void {
  const ctx = audio();
  if (!ctx || level <= 0) return;
  const at = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = noiseOf(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.Q.value = 1.2;
  filter.frequency.setValueAtTime(300, at);
  filter.frequency.exponentialRampToValueAtTime(2400, at + 1.2);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.12 * level, at + 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 2.2);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at, 0, 2.3);
  for (let i = 0; i < 8; i += 1) setTimeout(() => crackle(level), 100 + Math.random() * 1400);
}
