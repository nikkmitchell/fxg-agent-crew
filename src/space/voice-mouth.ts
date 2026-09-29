/**
 * A PERSON'S MOUTH MOVES WHEN THEY TALK. Nikk (2026-09-29, lobby 6222): "make
 * my mouth move when I talk... when there are loud sounds from my side, that
 * my mouth moves".
 *
 * Each voice-chat stream (everyone else's call, and your own microphone) gets
 * an analyser. Its loudness, eased so the jaw neither snaps nor lags, drives
 * the VRM "aa" (mouth open) expression on that person's body. Agents are not
 * metered here: their mouths already follow their spoken lines.
 */
import { audio } from "./breath-sound";

/** Quieter than this is breath and room noise: the mouth stays shut. */
export const MOUTH_QUIET_RMS = 0.012;
/** This loud or louder opens the mouth fully. */
export const MOUTH_LOUD_RMS = 0.09;
/** Opening is quick and closing a little slower, as a real jaw does. */
const OPEN_PER_SECOND = 18;
const CLOSE_PER_SECOND = 9;

/** 0 (shut) to 1 (wide open) for a loudness, before easing. */
export function mouthFor(rms: number): number {
  if (!(rms > MOUTH_QUIET_RMS)) return 0;
  return Math.min(1, (rms - MOUTH_QUIET_RMS) / (MOUTH_LOUD_RMS - MOUTH_QUIET_RMS));
}

/** Move `shown` toward `target` over `seconds`, faster opening than closing. */
export function easeMouth(shown: number, target: number, seconds: number): number {
  const rate = target > shown ? OPEN_PER_SECOND : CLOSE_PER_SECOND;
  const step = Math.min(1, Math.max(0, seconds) * rate);
  return shown + (target - shown) * step;
}

type Meter = {
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  samples: Float32Array<ArrayBuffer>;
  shown: number;
};
const meters = new Map<string, Meter>();
const key = (actorId: string) => actorId.toLowerCase();

function unmeter(id: string): void {
  const meter = meters.get(id);
  if (!meter) return;
  try {
    meter.source.disconnect();
  } catch {
    // Already disconnected.
  }
  meters.delete(id);
}

/**
 * Meter exactly these streams: everyone else's calls, plus your own
 * microphone under your own name while it is on. Anything no longer here is
 * let go. The analysers are not connected to the speakers, so nothing is
 * heard twice.
 */
export function meterVoices(streams: ReadonlyMap<string, MediaStream>, you: string | null, microphone: MediaStream | null): void {
  const wanted = new Map<string, MediaStream>();
  for (const [actorId, stream] of streams) wanted.set(key(actorId), stream);
  if (you && microphone) wanted.set(key(you), microphone);
  for (const id of [...meters.keys()]) {
    if (wanted.get(id) !== meters.get(id)?.stream) unmeter(id);
  }
  const context = audio();
  if (!context) return;
  for (const [id, stream] of wanted) {
    if (meters.has(id) || stream.getAudioTracks().length === 0) continue;
    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      meters.set(id, { stream, source, analyser, samples: new Float32Array(analyser.fftSize), shown: 0 });
    } catch {
      // A stream the browser will not meter: that mouth simply stays still.
    }
  }
}

/** How open this person's mouth should be from their voice right now, uneased; null when not metered. */
export function voiceTarget(actorId: string): number | null {
  const meter = meters.get(key(actorId));
  return meter ? mouthFor(rmsOf(meter.analyser, meter.samples)) : null;
}

function rmsOf(analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

/**
 * A meter on one stream on its own, for the avatar recorder's microphone,
 * which is not a call. `read` is the mouth for right now, uneased.
 */
export function streamMouth(stream: MediaStream): { read: () => number; stop: () => void } {
  const context = audio();
  if (!context || stream.getAudioTracks().length === 0) return { read: () => 0, stop: () => {} };
  try {
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    return {
      read: () => mouthFor(rmsOf(analyser, samples)),
      stop: () => {
        try {
          source.disconnect();
        } catch {
          // Already disconnected.
        }
      },
    };
  } catch {
    return { read: () => 0, stop: () => {} };
  }
}

/**
 * How open this person's mouth should be now, eased over `seconds` since the
 * last frame; null when they are not being metered (not in a call), so the
 * body's own expression stays in charge.
 */
export function voiceMouth(actorId: string, seconds: number): number | null {
  const meter = meters.get(key(actorId));
  if (!meter) return null;
  meter.shown = easeMouth(meter.shown, mouthFor(rmsOf(meter.analyser, meter.samples)), seconds);
  return meter.shown;
}
