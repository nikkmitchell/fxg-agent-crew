import { describe, expect, it } from "vitest";
import {
  COLUMN_TOP,
  MOTE_COUNT,
  SPEECH_CHARS_PER_SECOND,
  moteField,
  moteOpacity,
  pulseFor,
  speakingSeconds,
  stepMotes,
} from "./speaking-motes";

/**
 * The rules behind the light on a speaker. SpeakingMotes draws these; what it
 * LOOKS like needs eyes and is not asserted here.
 */
describe("how long somebody is shown as speaking", () => {
  /**
   * THE CONSTANT IS MEASURED, NOT CHOSEN. Utterance 286 on 2026-09-19 was 128
   * characters and the box rendered 8.83 seconds of 24 kHz mono audio for it.
   * If this ever drifts from what the engine actually does, this is the test
   * that should have caught it.
   */
  it("matches the real rendering it was derived from", () => {
    const measured = 128 / 8.83;
    expect(SPEECH_CHARS_PER_SECOND).toBeCloseTo(measured, 1);
    expect(speakingSeconds("x".repeat(128))).toBeCloseTo(8.83, 1);
  });

  it("gives a short line long enough to register as a pulse", () => {
    expect(speakingSeconds("Yes.")).toBeGreaterThanOrEqual(1.2);
  });

  it("never lights somebody up for ever", () => {
    expect(speakingSeconds("x".repeat(100_000))).toBeLessThanOrEqual(20);
  });

  it("is nothing at all for a line with no words", () => {
    expect(speakingSeconds("")).toBe(0);
    expect(speakingSeconds("   ")).toBe(0);
  });
});

describe("who gets lit up", () => {
  const line = { id: 7, actorId: "Sill", say: "Deployed and verified." };

  it("lights the speaker", () => {
    expect(pulseFor(line, "Nightjar", null)).toMatchObject({ actorId: "Sill" });
  });

  /** You know when you are talking; a light on your own chest is in the way. */
  it("never lights you for your own voice", () => {
    expect(pulseFor({ ...line, actorId: "Nightjar" }, "Nightjar", null)).toBeNull();
    expect(pulseFor({ ...line, actorId: "nightjar" }, "Nightjar", null)).toBeNull();
  });

  it("does not start the same line twice", () => {
    expect(pulseFor(line, "Nightjar", 7)).toBeNull();
  });

  /**
   * An utterance can carry only `detail` — written and never spoken. Lighting
   * somebody up for words nobody hears would be the room claiming something
   * that did not happen.
   */
  it("says nothing for an utterance with nothing spoken", () => {
    expect(pulseFor({ id: 8, actorId: "Sill", say: null }, "Nightjar", null)).toBeNull();
    expect(pulseFor({ id: 9, actorId: "Sill", say: "  " }, "Nightjar", null)).toBeNull();
  });

  it("lights a speaker even for a viewer who is not signed in", () => {
    expect(pulseFor(line, null, null)).toMatchObject({ actorId: "Sill" });
  });
});

describe("the motes themselves", () => {
  it("is the same field for the same seed, and a different one otherwise", () => {
    expect([...moteField(3).positions]).toEqual([...moteField(3).positions]);
    expect([...moteField(3).positions]).not.toEqual([...moteField(4).positions]);
  });

  it("starts spread through a column rather than all at the feet", () => {
    const heights = [...moteField(1).positions].filter((_, index) => index % 3 === 1);
    expect(Math.max(...heights)).toBeGreaterThan(COLUMN_TOP / 2);
    expect(new Set(heights).size).toBeGreaterThan(MOTE_COUNT / 2);
  });

  /**
   * THE THING THE HARNESS CAUGHT. At a radius of 0.12 the motes were inside the
   * body and over the face, so the effect hid the person it was pointing at.
   */
  it("stands off the figure rather than sitting inside it", () => {
    const { positions } = moteField(5);
    for (let i = 0; i < MOTE_COUNT; i += 1) {
      const radius = Math.hypot(positions[i * 3], positions[i * 3 + 2]);
      expect(radius).toBeGreaterThan(0.24);
    }
  });

  it("drifts upward and wraps, so the column never empties", () => {
    const { positions, rise } = moteField(2);
    for (let i = 0; i < 400; i += 1) stepMotes(positions, rise, 0.05);
    const heights = [...positions].filter((_, index) => index % 3 === 1);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(0);
    // AGAINST THE CONSTANT, not a copy of it. This said `1`, which was the old
    // ceiling written a second time, so raising the column broke a test that
    // had no opinion about the change.
    expect(Math.max(...heights)).toBeLessThanOrEqual(COLUMN_TOP);
  });

  it("fades in, pulses, and is gone by the end", () => {
    expect(moteOpacity(0, 6)).toBe(0);
    expect(moteOpacity(3, 6)).toBeGreaterThan(0);
    expect(moteOpacity(6, 6)).toBe(0);
    expect(moteOpacity(99, 6)).toBe(0);
  });

  it("actually pulses rather than holding steady", () => {
    const middle = Array.from({ length: 40 }, (_, i) => moteOpacity(2 + i * 0.05, 8));
    expect(Math.max(...middle) - Math.min(...middle)).toBeGreaterThan(0.1);
  });
});
