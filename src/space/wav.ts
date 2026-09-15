/**
 * Turning a recording into the one format a transcriber will take.
 *
 * WHY THE BROWSER DOES THIS AND NOT THE SERVER. A press-to-speak button needs
 * something to transcribe the audio, and whisper.cpp — the option that needs no
 * API key and lets nobody's voice leave our own machine — reads exactly one
 * thing: 16 kHz mono 16-bit PCM in a WAV container. A Quest records
 * `audio/webm;codecs=opus`.
 *
 * The obvious answer is ffmpeg on the server. The better answer is here: the
 * browser ALREADY has a complete audio decoder and resampler in
 * `AudioContext.decodeAudioData`, so converting in the page costs one function
 * and leaves the server needing a single binary rather than a media toolchain.
 * It also means the bytes on the wire are smaller than the compressed original
 * would be after a round trip, and the server never has to guess a format.
 *
 * All of this is pure and tested. The part that cannot be tested here — a real
 * microphone — is kept in the recorder that calls it.
 */

/** Mix however many channels down to one, by averaging. */
export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (let i = 0; i < out.length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Resample by linear interpolation.
 *
 * NOT A GOOD RESAMPLER, and deliberately so. Speech at 48 kHz down to 16 kHz
 * loses everything above 8 kHz either way; linear interpolation adds some
 * aliasing that a proper low-pass would avoid, and whisper does not care —
 * it is trained on exactly this kind of telephone-grade audio. A windowed-sinc
 * kernel here would be fifty lines defending a difference nobody can hear.
 */
export function resampleTo(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const ratio = from / to;
  const length = Math.max(1, Math.floor(samples.length / ratio));
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(samples.length - 1, low + 1);
    const part = at - low;
    out[i] = samples[low] * (1 - part) + samples[high] * part;
  }
  return out;
}

/** WAV's fixed 44-byte header, then the samples. */
export const WAV_HEADER_BYTES = 44;

/**
 * 16-bit PCM in a WAV container.
 *
 * Clamped before scaling, because a sample slightly past 1.0 — which a mix of
 * channels or a resample can produce — wraps to the opposite extreme in a
 * 16-bit integer and arrives as a loud click.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * 2);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(at + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true); // the size of this chunk
  view.setUint16(20, 1, true); // PCM, uncompressed
  view.setUint16(22, 1, true); // one channel
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a frame
  view.setUint16(34, 16, true); // bits a sample
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    // Asymmetric on purpose: 16-bit signed runs -32768..32767, and scaling the
    // positive side by 32768 would overflow at full deflection.
    view.setInt16(WAV_HEADER_BYTES + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/** What a transcriber wants, and what the server is built to expect. */
export const TRANSCRIBE_RATE = 16_000;

/** How loud the recording is overall, 0 to 1 — for "I heard nothing" before sending. */
export function loudness(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}
