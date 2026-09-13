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
      avatar: { mood: "happy", gesture: "wave", gestureStartedAt: 1_000, posture: "resting" },
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
 * Nikk wanted the room inhabited rather than lined with statues: thinking while
 * working, and something restful while not. These check the two things that
 * would make it look wrong rather than merely different — a figure sitting in
 * mid-air, and a figure meditating while walking across the room.
 */
describe("postures", () => {
  const posed = (posture: "resting" | "thinking" | "meditating", extra = {}) =>
    frame({
      nowMs: 5_000,
      avatar: { mood: "neutral", gesture: null, gestureStartedAt: null, posture },
      ...extra,
    });

  it("stands at rest by default, with its feet on the floor", () => {
    const at = posed("resting");
    expect(at.rootDrop).toBe(0);
    expect(at.leftUpperLeg.x).toBe(0);
  });

  it("SITS DOWN to meditate rather than folding its legs in mid-air", () => {
    // Rotating the legs without dropping the hips leaves a figure standing
    // with its knees bent in front of it, which reads as broken, not seated.
    const sitting = posed("meditating");
    expect(sitting.rootDrop).toBeGreaterThan(0.3);
    expect(sitting.leftLowerLeg.x).toBeGreaterThan(1);
    expect(sitting.rightLowerLeg.x).toBeGreaterThan(1);
  });

  it("crosses its legs symmetrically", () => {
    const sitting = posed("meditating");
    expect(sitting.leftUpperLeg.x).toBeCloseTo(sitting.rightUpperLeg.x, 6);
    expect(sitting.leftUpperLeg.y).toBeCloseTo(-sitting.rightUpperLeg.y, 6);
  });

  it("brings a hand to the chin to think, and only one", () => {
    const thinking = posed("thinking");
    const resting = posed("resting");
    expect(thinking.rightLowerArm.z).toBeGreaterThan(resting.rightLowerArm.z + 0.5);
    expect(thinking.leftUpperArm.z).toBeGreaterThan(0);
  });

  it("DOES NOT MEDITATE WHILE WALKING", () => {
    // A posture is what you do while you are still. Sitting cross-legged as
    // you cross the room is the single most obviously wrong thing this could
    // produce.
    const walking = posed("meditating", { moving: true });
    expect(walking.rootDrop).toBe(0);
  });

  it("still answers somebody who speaks to it while it is meditating", () => {
    // Attention beats posture: it is a response to a person, and a posture is
    // only what you were doing until they turned up.
    const sitting = posed("meditating");
    const attentive = posed("meditating", { attending: true });
    expect(attentive.rightLowerArm.z).not.toBeCloseTo(sitting.rightLowerArm.z, 6);
    // But it stays sitting — it does not leap to its feet.
    expect(attentive.rootDrop).toBeGreaterThan(0.3);
  });

  it("holds still for reduced motion, in every posture", () => {
    for (const posture of ["resting", "thinking", "meditating"] as const) {
      const a = posed(posture, { reducedMotion: true, nowMs: 1_000 });
      const b = posed(posture, { reducedMotion: true, nowMs: 9_000 });
      expect(a.chest.x).toBe(b.chest.x);
      expect(a.expressions.blink).toBe(b.expressions.blink);
    }
  });
});
