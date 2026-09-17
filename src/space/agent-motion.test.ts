import { describe, expect, it } from "vitest";
import { agentMotionFrame } from "./agent-motion";

const frame = (changes: Partial<Parameters<typeof agentMotionFrame>[0]> = {}) => agentMotionFrame({
  actorId: "Inkstone",
  attending: false,
  speaking: false,
  moving: false,
  nowMs: 1_000,
  reducedMotion: false,
  ...changes,
});

describe("automatic agent motion", () => {
  it("lowers both arms from the model's T-pose while idle", () => {
    const idle = frame();
    expect(idle.leftUpperArm.z).toBeGreaterThan(1);
    expect(idle.rightUpperArm.z).toBeLessThan(-1);
  });

  it("opens the mouth and changes the arms while speaking", () => {
    const speaking = frame({ speaking: true });
    expect(speaking.expressions.aa).toBeGreaterThan(0);
    expect(Math.abs(speaking.leftUpperArm.z)).toBeLessThan(1.1);
  });

  it("turns declared attention into a thoughtful pose", () => {
    const attending = frame({ attending: true });
    expect(attending.head.x).toBeGreaterThan(0);
    expect(attending.rightLowerArm.z).toBeGreaterThan(0.8);
  });

  it("walks with opposite leg phases instead of sliding", () => {
    const walking = frame({ moving: true, nowMs: 1_400 });
    expect(walking.leftUpperLeg.x).toBeCloseTo(-walking.rightUpperLeg.x, 6);
    expect(Math.abs(walking.leftUpperLeg.x)).toBeGreaterThan(0.05);
    expect(walking.leftLowerLeg.x + walking.rightLowerLeg.x).toBeGreaterThan(0);
  });

  it("honours explicit mood and gesture controls", () => {
    const waving = frame({
      nowMs: 2_000,
      avatar: { mood: "happy", gesture: "wave", gestureStartedAt: 1_000, gestureHoldMs: null, posture: "resting" },
    });
    expect(waving.expressions.happy).toBeGreaterThan(0);
    expect(Math.abs(waving.rightUpperArm.z)).toBeLessThan(0.3);
  });

  it("removes idle oscillation for reduced motion", () => {
    const first = frame({ reducedMotion: true, nowMs: 1_000 });
    const later = frame({ reducedMotion: true, nowMs: 9_000 });
    expect(later.chest).toEqual(first.chest);
    expect(later.head).toEqual(first.head);
  });

  it("does not oscillate its gait when reduced motion is requested", () => {
    const first = frame({ moving: true, reducedMotion: true, nowMs: 1_000 });
    const later = frame({ moving: true, reducedMotion: true, nowMs: 9_000 });
    expect(later.leftUpperLeg).toEqual(first.leftUpperLeg);
    expect(later.rightUpperLeg).toEqual(first.rightUpperLeg);
  });
});

/**
 * Postures — what an agent is doing with itself while it stands there.
 *
 * All of them are STANDING. A cross-legged sit was tried and removed: posing a
 * seated body by hand produced a crumple with an ankle below the floor, and a
 * sit needs a real animation clip rather than guessed angles. Each of these is
 * a small deviation from a stance that already looks right.
 */
describe("postures", () => {
  const posed = (posture: "resting" | "thinking" | "sleeping", extra = {}) =>
    frame({
      nowMs: 5_000,
      avatar: { mood: "neutral", gesture: null, gestureStartedAt: null, gestureHoldMs: null, posture },
      ...extra,
    });

  it("rests with its arms down and its feet under it", () => {
    const at = posed("resting");
    expect(at.leftUpperLeg.x).toBe(0);
    expect(at.leftUpperArm.z).toBeGreaterThan(1);
  });

  it("CLOSES ITS EYES to sleep, and keeps them closed", () => {
    // Held shut, not a blink that happens to be down — a slow blinker does not
    // read as asleep.
    for (const nowMs of [1_000, 4_000, 9_000]) {
      const dozing = frame({
        nowMs,
        avatar: { mood: "neutral", gesture: null, gestureStartedAt: null, gestureHoldMs: null, posture: "sleeping" },
      });
      expect(dozing.expressions.blink).toBe(1);
    }
  });

  it("bows its head to sleep but stays on its feet", () => {
    const dozing = posed("sleeping");
    const awake = posed("resting");
    expect(dozing.head.x).toBeGreaterThan(awake.head.x);
    expect(dozing.leftUpperLeg.x).toBe(0);
    expect(dozing.rightUpperLeg.x).toBe(0);
  });

  it("brings a hand to the chin to think, and only one", () => {
    const thinking = posed("thinking");
    const resting = posed("resting");
    expect(thinking.rightLowerArm.z).toBeGreaterThan(resting.rightLowerArm.z + 0.5);
    expect(thinking.leftUpperArm.z).toBeGreaterThan(0);
  });

  it("does not doze while walking across the room", () => {
    const walking = posed("sleeping", { moving: true });
    expect(walking.expressions.blink).not.toBe(1);
  });

  it("still answers somebody who speaks to it while it is asleep", () => {
    const dozing = posed("sleeping");
    const attentive = posed("sleeping", { attending: true });
    expect(attentive.rightLowerArm.z).not.toBeCloseTo(dozing.rightLowerArm.z, 6);
  });

  it("holds still for reduced motion, in every posture", () => {
    for (const posture of ["resting", "thinking", "sleeping"] as const) {
      const a = posed(posture, { reducedMotion: true, nowMs: 1_000 });
      const b = posed(posture, { reducedMotion: true, nowMs: 9_000 });
      expect(a.chest.x).toBe(b.chest.x);
    }
  });
});
