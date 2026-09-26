import { describe, expect, it } from "vitest";
import { classifyMicHand, fingersStraight, palmNormalOf, type MicGestureHand } from "./mic-gesture-input";
import {
  IDLE_MIC_GESTURE,
  MIC_GESTURE_FIST_HOLD_MS,
  MIC_GESTURE_HOLD_MS,
  MIC_GESTURE_TILT_RADIANS,
  startPoseProblem,
  stepMicGesture,
  type MicGestureHands,
} from "./mic-gesture";

const identity = { x: 0, y: 0, z: 0, w: 1 };
// The head 0.4 m behind and 0.3 m above the hand, facing -z: the hand is in
// front of the face. The palm faces +x: edge-on, like a chop.
const openHand = (rotation = identity, x = 0): MicGestureHand => ({
  wrist: { p: { x, y: 1, z: 0 }, q: rotation },
  fingerDirection: { x: 0, y: 1, z: 0 },
  shape: "open",
  joints: [],
  straight: true,
  palmNormal: { x: 1, y: 0, z: 0 },
  head: { p: { x: 0, y: 1.3, z: 0.4 }, q: identity },
});
const fistHand = (rotation = identity): MicGestureHand => ({ ...openHand(rotation), shape: "fist" });
const hands = (right: MicGestureHand | null, left: MicGestureHand | null = null): MicGestureHands => ({ left, right });
const rotationBy = (radians: number) => ({ x: Math.sin(radians / 2), y: 0, z: 0, w: Math.cos(radians / 2) });

function startGesture(hand: MicGestureHand = openHand()) {
  const first = stepMicGesture(IDLE_MIC_GESTURE, hands(hand), false, 1_000);
  expect(first.action).toBeUndefined();
  const started = stepMicGesture(first.state, hands(hand), false, 1_000 + MIC_GESTURE_HOLD_MS);
  expect(started.action).toBe("start");
  const recording = stepMicGesture(started.state, hands(hand), true, 1_501);
  expect(recording.state.phase).toBe("recording");
  return recording.state;
}

describe("mic hand gesture", () => {
  it("requires an upright open hand to stay still for half a second", () => {
    const tiltedAway = openHand(identity);
    tiltedAway.fingerDirection = { x: 1, y: 0, z: 0 };
    expect(stepMicGesture(IDLE_MIC_GESTURE, hands(tiltedAway), false, 1).state.phase).toBe("idle");
    expect(stepMicGesture(IDLE_MIC_GESTURE, hands(fistHand()), false, 1).state.phase).toBe("idle");

    const arming = stepMicGesture(IDLE_MIC_GESTURE, hands(openHand()), false, 1_000);
    expect(stepMicGesture(arming.state, hands(openHand()), false, 1_000 + MIC_GESTURE_HOLD_MS - 1).action).toBeUndefined();
    expect(stepMicGesture(arming.state, hands(openHand()), false, 1_000 + MIC_GESTURE_HOLD_MS).action).toBe("start");
  });

  it("restarts the hold if the hand moves or rotates before it starts", () => {
    const arming = stepMicGesture(IDLE_MIC_GESTURE, hands(openHand()), false, 1_000);
    const moved = stepMicGesture(arming.state, hands(openHand(identity, 0.06)), false, 1_400);
    expect(moved.state.phase).toBe("arming");
    expect(moved.action).toBeUndefined();
    expect(stepMicGesture(moved.state, hands(openHand(identity, 0.06)), false, 1_899).action).toBeUndefined();
    expect(stepMicGesture(moved.state, hands(openHand(identity, 0.06)), false, 1_900).action).toBe("start");
  });

  it("finishes once the tracked wrist tilts 30 degrees from the starting pose", () => {
    const state = startGesture();
    const justShort = stepMicGesture(state, hands(openHand(rotationBy(MIC_GESTURE_TILT_RADIANS - 0.01))), true, 2_000);
    expect(justShort.action).toBeUndefined();
    const finished = stepMicGesture(state, hands(openHand(rotationBy(MIC_GESTURE_TILT_RADIANS))), true, 2_001);
    expect(finished.action).toBe("finish");
    expect(finished.state.phase).toBe("ending");
    expect(stepMicGesture(finished.state, hands(openHand()), true, 2_100).action).toBeUndefined();
  });

  it("cancels with a held fist, not on a short fist-like tracking sample", () => {
    const state = startGesture();
    const firstFist = stepMicGesture(state, hands(fistHand()), true, 2_000);
    expect(firstFist.action).toBeUndefined();
    const cancelled = stepMicGesture(firstFist.state, hands(fistHand()), true, 2_000 + MIC_GESTURE_FIST_HOLD_MS);
    expect(cancelled.action).toBe("cancel");
  });

  it("does not stop recording on tracking loss and can arm a newly tracked hand", () => {
    const state = startGesture();
    const dropped = stepMicGesture(state, hands(null), true, 2_000);
    expect(dropped.action).toBeUndefined();
    const stillWaiting = stepMicGesture(dropped.state, hands(null), true, 2_500);
    expect(stillWaiting.action).toBeUndefined();
    const lostBaseline = stepMicGesture(stillWaiting.state, hands(null), true, 3_000);
    expect(lostBaseline.action).toBeUndefined();
    const handReturns = stepMicGesture(lostBaseline.state, hands(null, openHand()), true, 3_001);
    expect(handReturns.action).toBeUndefined();
    expect(handReturns.state.phase).toBe("recording");
    expect(stepMicGesture(handReturns.state, hands(null, openHand(rotationBy(0.53))), true, 3_100).action).toBe("finish");
  });

  it("can be disabled without changing the touch mic's independent behavior", () => {
    const result = stepMicGesture(IDLE_MIC_GESTURE, hands(openHand()), false, 1_000, false);
    expect(result.state).toEqual(IDLE_MIC_GESTURE);
    expect(result.action).toBeUndefined();
  });

  it("classifies only fully tracked, clear open and fist poses", () => {
    const wrist = { x: 0, y: 0, z: 0 };
    const bases = [0, 1, 2, 3].map((i) => ({ x: i * 0.01, y: 0.05, z: 0 }));
    const openTips = bases.map((base) => ({ ...base, y: 0.16 }));
    const fistTips = bases.map((base) => ({ ...base, y: 0.04 }));
    expect(classifyMicHand(wrist, bases, openTips)).toBe("open");
    expect(classifyMicHand(wrist, bases, fistTips)).toBe("fist");
    expect(classifyMicHand(wrist, bases.slice(0, 3), openTips.slice(0, 3))).toBe("other");
  });

  describe("only the karate-chop pose Nikk described starts it (5004)", () => {
    it("accepts a flat, upright, edge-on hand in front of the face", () => {
      expect(startPoseProblem(openHand())).toBeNull();
    });

    it("turns away a half-open fist: fingers out but not straight", () => {
      expect(startPoseProblem({ ...openHand(), straight: false })).toBe("not flat");
    });

    it("turns away a hand leaning more than 25° from upright", () => {
      const leaning = openHand();
      leaning.fingerDirection = { x: Math.sin(0.6), y: Math.cos(0.6), z: 0 };
      expect(startPoseProblem(leaning)).toBe("not pointing up");
    });

    it("turns away a high five: the palm facing forward, away from you", () => {
      expect(startPoseProblem({ ...openHand(), palmNormal: { x: 0, y: 0, z: -1 } })).toBe("palm not edge-on");
    });

    it("turns away a hand held up off to the side", () => {
      expect(startPoseProblem(openHand(identity, 0.6))).toBe("not in front");
    });

    it("turns away a hand down by your waist or out of reach", () => {
      expect(startPoseProblem({ ...openHand(), head: { p: { x: 0, y: 1.7, z: 0.3 }, q: identity } })).toBe("not at face height");
      expect(startPoseProblem({ ...openHand(), head: { p: { x: 0, y: 1.2, z: 1.2 }, q: identity } })).toBe("too far away");
    });

    it("never starts without the head or the palm tracked", () => {
      expect(startPoseProblem({ ...openHand(), head: null })).toBe("not tracked");
      expect(startPoseProblem({ ...openHand(), palmNormal: null })).toBe("not tracked");
    });

    it("tells a straight finger from a bent one", () => {
      const joints: ({ x: number; y: number; z: number } | null)[] = Array.from({ length: 25 }, () => null);
      const finger = (base: number, x: number, bent: boolean) => {
        joints[base] = { x, y: 0, z: 0 };
        joints[base + 1] = { x, y: 0.06, z: 0 };
        joints[base + 2] = bent ? { x, y: 0.09, z: -0.03 } : { x, y: 0.1, z: 0 };
        joints[base + 4] = bent ? { x, y: 0.07, z: -0.05 } : { x, y: 0.13, z: 0 };
      };
      [5, 10, 15, 20].forEach((base, i) => finger(base, i * 0.02, false));
      expect(fingersStraight(joints)).toBe(true);
      finger(10, 0.02, true);
      expect(fingersStraight(joints)).toBe(false);
    });

    it("finds the palm facing out of the hand's flat side", () => {
      const joints: ({ x: number; y: number; z: number } | null)[] = Array.from({ length: 25 }, () => null);
      // Knuckles across z, fingers up y: the palm faces along x.
      joints[0] = { x: 0, y: 0, z: 0 };
      joints[6] = { x: 0, y: 0.09, z: -0.03 };
      joints[11] = { x: 0, y: 0.1, z: 0 };
      joints[21] = { x: 0, y: 0.08, z: 0.04 };
      const n = palmNormalOf(joints)!;
      expect(Math.abs(n.x)).toBeCloseTo(1, 1);
    });
  });
});
