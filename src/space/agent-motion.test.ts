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
      avatar: { mood: "happy", gesture: "wave", gestureStartedAt: 1_000 },
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
