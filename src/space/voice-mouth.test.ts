import { describe, expect, it, vi } from "vitest";

let level = 0;
const disconnected: string[] = [];
vi.mock("./breath-sound", () => ({
  audio: () => ({
    createMediaStreamSource: (stream: { id: string }) => ({ connect: () => {}, disconnect: () => disconnected.push(stream.id) }),
    createAnalyser: () => ({
      fftSize: 0,
      connect: () => {},
      getFloatTimeDomainData: (into: Float32Array) => into.fill(level),
    }),
  }),
}));

import { easeMouth, meterVoices, MOUTH_LOUD_RMS, MOUTH_QUIET_RMS, mouthFor, voiceMouth } from "./voice-mouth";

const stream = (id: string) => ({ id, getAudioTracks: () => [{}] }) as unknown as MediaStream;

describe("a mouth that follows a voice (Nikk, 6222)", () => {
  it("stays shut for breath and room noise, and opens fully when loud", () => {
    expect(mouthFor(0)).toBe(0);
    expect(mouthFor(MOUTH_QUIET_RMS)).toBe(0);
    expect(mouthFor((MOUTH_QUIET_RMS + MOUTH_LOUD_RMS) / 2)).toBeCloseTo(0.5);
    expect(mouthFor(MOUTH_LOUD_RMS * 3)).toBe(1);
  });

  it("opens quickly and closes a little more slowly", () => {
    const opened = easeMouth(0, 1, 1 / 60);
    const closed = 1 - easeMouth(1, 0, 1 / 60);
    expect(opened).toBeGreaterThan(closed);
    expect(easeMouth(0.3, 0.3, 1)).toBeCloseTo(0.3);
  });

  it("meters each call and your own microphone, and lets go of what has gone", () => {
    const theirs = stream("theirs");
    const mine = stream("mine");
    meterVoices(new Map([["Baiwei2", theirs]]), "Nikk2", mine);
    level = 0.2;
    for (let frame = 0; frame < 30; frame += 1) voiceMouth("baiwei2", 1 / 60);
    expect(voiceMouth("BAIWEI2", 1 / 60)).toBeGreaterThan(0.9);
    expect(voiceMouth("nikk2", 1)).toBeGreaterThan(0.5);
    expect(voiceMouth("Sill", 1 / 60)).toBeNull();

    // The microphone goes off: your mouth is no longer driven, theirs still is.
    meterVoices(new Map([["Baiwei2", theirs]]), "Nikk2", null);
    expect(disconnected).toContain("mine");
    expect(voiceMouth("nikk2", 1 / 60)).toBeNull();
    expect(voiceMouth("baiwei2", 1 / 60)).not.toBeNull();

    // Silence closes it again.
    level = 0;
    for (let frame = 0; frame < 120; frame += 1) voiceMouth("baiwei2", 1 / 60);
    expect(voiceMouth("baiwei2", 1 / 60)).toBeLessThan(0.01);
    meterVoices(new Map(), null, null);
    expect(voiceMouth("baiwei2", 1 / 60)).toBeNull();
  });
});
