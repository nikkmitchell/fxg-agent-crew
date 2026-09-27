/**
 * Ambient soundscapes under a meditation: rain, a stream, singing bowls, a
 * summer night.
 *
 * MADE, NOT DOWNLOADED. Every sound here is synthesised in the browser from
 * noise and sine waves, so there is no file to fetch into a headset, no licence
 * to check, and it loops for ever without a seam. The same shared AudioContext
 * as the orb's tones (breath-sound.ts).
 *
 * PER PERSON, like SOUND ON/OFF: one person can sit in the rain while the
 * person beside them has silence. Nothing about it goes to the server.
 */
import { audio } from "./breath-sound";

export const SOUNDSCAPES = ["off", "rain", "stream", "bowls", "night", "ocean", "wind"] as const;
export type Soundscape = (typeof SOUNDSCAPES)[number];

export const SOUNDSCAPE_LABEL: Record<Soundscape, string> = {
  off: "AMBIENT OFF",
  rain: "RAIN",
  stream: "STREAM",
  bowls: "BOWLS",
  night: "NIGHT",
  ocean: "OCEAN",
  wind: "WIND",
};

export function nextSoundscape(now: Soundscape): Soundscape {
  return SOUNDSCAPES[(SOUNDSCAPES.indexOf(now) + 1) % SOUNDSCAPES.length];
}

export function isSoundscape(value: unknown): value is Soundscape {
  return typeof value === "string" && (SOUNDSCAPES as readonly string[]).includes(value);
}

/** The partials of a singing bowl, as multiples of its note: inharmonic, which is what makes it a bowl. */
export const BOWL_PARTIALS = [1, 2.76, 5.4] as const;
/** A pentatonic set, so any two bowls struck together still agree. */
export const BOWL_NOTES = [174.6, 196, 220, 261.6, 293.7] as const;

function noiseBuffer(ctx: AudioContext, kind: "white" | "brown"): AudioBuffer {
  const seconds = 4;
  const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < data.length; i += 1) {
    const white = Math.random() * 2 - 1;
    if (kind === "white") data[i] = white;
    else {
      // Brown noise: integrated white, leaking back toward zero so it never drifts off.
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
  }
  return buffer;
}

/** Start a soundscape. Returns a function that fades it out and lets go of it. */
export function playSoundscape(kind: Soundscape): () => void {
  const ctx = audio();
  if (!ctx || kind === "off") return () => {};
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, ctx.currentTime);
  // Fade in over three seconds: a sound that arrives suddenly is not calming.
  master.gain.exponentialRampToValueAtTime(1, ctx.currentTime + 3);
  master.connect(ctx.destination);
  const stops: Array<() => void> = [];
  const timers: number[] = [];

  const loop = (buffer: AudioBuffer) => {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.start();
    stops.push(() => source.stop());
    return source;
  };
  const lfo = (target: AudioParam, rate: number, depth: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = rate;
    gain.gain.value = depth;
    osc.connect(gain).connect(target);
    osc.start();
    stops.push(() => osc.stop());
  };

  if (kind === "rain") {
    const hiss = loop(noiseBuffer(ctx, "white"));
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 900;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 7000;
    const level = ctx.createGain();
    level.gain.value = 0.035;
    lfo(level.gain, 0.07, 0.01);
    hiss.connect(high).connect(low).connect(level).connect(master);
    // The patter: soft low thumps of heavier drops, a few a second at random.
    const drop = () => {
      const at = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.setValueAtTime(1200 + Math.random() * 1800, at);
      osc.frequency.exponentialRampToValueAtTime(300, at + 0.05);
      gain.gain.setValueAtTime(0.008 + Math.random() * 0.01, at);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
      osc.connect(gain).connect(master);
      osc.start(at);
      osc.stop(at + 0.08);
      timers.push(window.setTimeout(drop, 80 + Math.random() * 400));
    };
    drop();
  } else if (kind === "stream") {
    const water = loop(noiseBuffer(ctx, "brown"));
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 600;
    band.Q.value = 0.8;
    lfo(band.frequency, 0.11, 220);
    const level = ctx.createGain();
    level.gain.value = 0.09;
    lfo(level.gain, 0.23, 0.025);
    water.connect(band).connect(level).connect(master);
    const ripple = loop(noiseBuffer(ctx, "white"));
    const high = ctx.createBiquadFilter();
    high.type = "bandpass";
    high.frequency.value = 2600;
    high.Q.value = 3;
    lfo(high.frequency, 0.9, 900);
    const shimmer = ctx.createGain();
    shimmer.gain.value = 0.006;
    ripple.connect(high).connect(shimmer).connect(master);
  } else if (kind === "bowls") {
    const strike = () => {
      const note = BOWL_NOTES[Math.floor(Math.random() * BOWL_NOTES.length)];
      const at = ctx.currentTime;
      BOWL_PARTIALS.forEach((partial, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = note * partial;
        // A slow beat on the fundamental, the wobble a real bowl has.
        if (index === 0) lfoOnce(ctx, osc.frequency, 0.6 + Math.random(), 0.8, at + 12);
        const peak = [0.05, 0.018, 0.007][index];
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 12 - index * 3);
        osc.connect(gain).connect(master);
        osc.start(at);
        osc.stop(at + 12.1);
      });
      timers.push(window.setTimeout(strike, 7000 + Math.random() * 6000));
    };
    strike();
  } else if (kind === "night") {
    const air = loop(noiseBuffer(ctx, "brown"));
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 400;
    const level = ctx.createGain();
    level.gain.value = 0.03;
    air.connect(low).connect(level).connect(master);
    // Crickets: a quick triple chirp near 4.5 kHz, from time to time.
    const chirp = () => {
      const at = ctx.currentTime;
      const pitch = 4300 + Math.random() * 500;
      for (let n = 0; n < 3; n += 1) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = pitch;
        const t = at + n * 0.07;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.006, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
        osc.connect(gain).connect(master);
        osc.start(t);
        osc.stop(t + 0.05);
      }
      timers.push(window.setTimeout(chirp, 600 + Math.random() * 2200));
    };
    chirp();
  }

  if (kind === "ocean") {
    // Waves: brown noise through a low-pass that opens and closes over about
    // ten seconds, with the level swelling in step: a wave arriving, a wave
    // drawing back.
    const sea = loop(noiseBuffer(ctx, "brown"));
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 700;
    lfo(low.frequency, 0.1, 500);
    const level = ctx.createGain();
    level.gain.value = 0.08;
    lfo(level.gain, 0.1, 0.06);
    sea.connect(low).connect(level).connect(master);
    // The hiss of foam at the top of each wave.
    const foam = loop(noiseBuffer(ctx, "white"));
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 3000;
    const spray = ctx.createGain();
    spray.gain.value = 0.004;
    lfo(spray.gain, 0.1, 0.004);
    foam.connect(high).connect(spray).connect(master);
  } else if (kind === "wind") {
    // Wind: white noise through a narrow band that wanders in pitch, and gusts
    // that rise and fall on two slow, unrelated cycles so it never repeats.
    const air = loop(noiseBuffer(ctx, "white"));
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 500;
    band.Q.value = 1.6;
    lfo(band.frequency, 0.05, 250);
    lfo(band.frequency, 0.13, 90);
    const level = ctx.createGain();
    level.gain.value = 0.05;
    lfo(level.gain, 0.07, 0.03);
    lfo(level.gain, 0.19, 0.012);
    air.connect(band).connect(level).connect(master);
  }

  return () => {
    for (const timer of timers) window.clearTimeout(timer);
    const at = ctx.currentTime;
    master.gain.cancelScheduledValues(at);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), at);
    master.gain.exponentialRampToValueAtTime(0.0001, at + 1.5);
    window.setTimeout(() => {
      for (const stop of stops) {
        try { stop(); } catch { /* already stopped */ }
      }
      master.disconnect();
    }, 1600);
  };
}

function lfoOnce(ctx: AudioContext, target: AudioParam, rate: number, depth: number, until: number): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = rate;
  gain.gain.value = depth;
  osc.connect(gain).connect(target);
  osc.start();
  osc.stop(until);
}
