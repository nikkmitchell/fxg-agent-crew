import { describe, expect, it } from "vitest";
import { WAV_HEADER_BYTES, encodeWav, loudness, resampleTo, toMono } from "./wav";

const readText = (view: DataView, at: number, length: number) =>
  Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(at + i))).join("");

describe("mixing down to one channel", () => {
  it("leaves a mono recording exactly as it is", () => {
    const only = new Float32Array([0.1, -0.2]);
    expect(toMono([only])).toBe(only);
  });

  it("averages a stereo recording", () => {
    expect(Array.from(toMono([new Float32Array([1, 0]), new Float32Array([0, 1])]))).toEqual([0.5, 0.5]);
  });

  it("has something to say about no channels at all", () => {
    expect(toMono([]).length).toBe(0);
  });
});

describe("resampling to what a transcriber reads", () => {
  it("does nothing when the rate already matches", () => {
    const same = new Float32Array([0.5, 0.25]);
    expect(resampleTo(same, 16_000, 16_000)).toBe(same);
  });

  it("shortens 48 kHz to a third of its length at 16 kHz", () => {
    const samples = new Float32Array(48_000).fill(0.5);
    expect(resampleTo(samples, 48_000, 16_000).length).toBe(16_000);
  });

  it("keeps a steady tone steady rather than scaling it", () => {
    const out = resampleTo(new Float32Array(300).fill(0.4), 48_000, 16_000);
    for (const sample of out) expect(sample).toBeCloseTo(0.4, 6);
  });

  it("interpolates between neighbours instead of dropping to the nearest", () => {
    // A ramp resampled 2:1 should still be a ramp, not a staircase.
    const ramp = new Float32Array([0, 0.25, 0.5, 0.75]);
    const out = resampleTo(ramp, 2, 1);
    expect(Array.from(out)).toEqual([0, 0.5]);
  });
});

describe("the WAV a transcriber will accept", () => {
  it("writes the header whisper.cpp insists on: PCM, mono, the rate we said", () => {
    const wav = encodeWav(new Float32Array([0, 0.5]), 16_000);
    const view = new DataView(wav);
    expect(readText(view, 0, 4)).toBe("RIFF");
    expect(readText(view, 8, 4)).toBe("WAVE");
    expect(readText(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true), "format 1 is uncompressed PCM").toBe(1);
    expect(view.getUint16(22, true), "one channel").toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true), "16 bits a sample").toBe(16);
    expect(readText(view, 36, 4)).toBe("data");
  });

  it("gives every length the sizes the container promises", () => {
    const wav = encodeWav(new Float32Array(100), 16_000);
    const view = new DataView(wav);
    expect(wav.byteLength).toBe(WAV_HEADER_BYTES + 200);
    expect(view.getUint32(4, true), "everything after the first eight bytes").toBe(36 + 200);
    expect(view.getUint32(40, true), "the samples alone").toBe(200);
    expect(view.getUint32(28, true), "bytes a second at 16 kHz mono 16-bit").toBe(32_000);
  });

  /**
   * The click this avoids is real: a mix of two channels, or a resample, can
   * hand back 1.0000001, and in a 16-bit integer that wraps to the loudest
   * possible NEGATIVE sample. One frame of that is an audible tick.
   */
  it("clamps a sample past full deflection instead of wrapping it", () => {
    const view = new DataView(encodeWav(new Float32Array([1.2, -1.4]), 16_000));
    expect(view.getInt16(WAV_HEADER_BYTES, true)).toBe(32_767);
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(-32_768);
  });

  it("writes silence as silence", () => {
    const view = new DataView(encodeWav(new Float32Array([0, 0]), 16_000));
    expect(view.getInt16(WAV_HEADER_BYTES, true)).toBe(0);
    expect(view.getInt16(WAV_HEADER_BYTES + 2, true)).toBe(0);
  });
});

describe("how loud a recording is", () => {
  it("is zero for silence and for nothing at all", () => {
    expect(loudness(new Float32Array(100))).toBe(0);
    expect(loudness(new Float32Array(0))).toBe(0);
  });

  it("rises with the signal, so a muted microphone can be told apart from speech", () => {
    const quiet = loudness(new Float32Array(100).fill(0.001));
    const speech = loudness(new Float32Array(100).fill(0.2));
    expect(quiet).toBeLessThan(0.01);
    expect(speech).toBeGreaterThan(0.1);
  });
});
