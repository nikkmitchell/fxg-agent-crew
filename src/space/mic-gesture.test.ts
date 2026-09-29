import { describe, expect, it } from "vitest";
import { classifyMicHand, closedness, fingersStraight, mostlyClosed, palmNormalOf, type MicGestureHand } from "./mic-gesture-input";
import {
  IDLE_MIC_GESTURE,
  MIC_GESTURE_FIST_HOLD_MS,
  MIC_GESTURE_HOLD_MS,
  MIC_GESTURE_TILT_RADIANS,
  describeStart,
  startPoseMeasures,
  startPoseProblem,
  stepMicGesture,
  type MicGestureHands,
} from "./mic-gesture";

const identity = { x: 0, y: 0, z: 0, w: 1 };
// The head 0.4 m behind and 0.3 m above the hand, facing -z: the hand is in
// front of the face. The palm normal is +x: edge-on and facing in, like a
// praying hand (see palmIn).
type Q = { x: number; y: number; z: number; w: number };
type V = { x: number; y: number; z: number };
/** v turned by the unit quaternion q. */
const turn = (q: Q, v: V): V => {
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + (q.y * tz - q.z * ty), y: v.y + q.w * ty + (q.z * tx - q.x * tz), z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
};
// The fingers and the palm turn WITH the wrist, as a real hand's do.
const openHand = (rotation: Q = identity, x = 0): MicGestureHand => ({
  wrist: { p: { x, y: 1, z: 0 }, q: rotation },
  fingerDirection: turn(rotation, { x: 0, y: 1, z: 0 }),
  shape: "open",
  joints: [],
  straight: true,
  palmNormal: turn(rotation, { x: 1, y: 0, z: 0 }),
  head: { p: { x: 0, y: 1.3, z: 0.4 }, q: identity },
  closed: false,
  closedness: 0,
});
const fistHand = (rotation = identity): MicGestureHand => ({ ...openHand(rotation), shape: "fist", closed: true, closedness: 1 });
const hands = (right: MicGestureHand | null, left: MicGestureHand | null = null): MicGestureHands => ({ left, right });
// About x, the palm normal: the flat hand swings in its own plane, fingertips
// tipping FORWARD and down, away from the face (the head is at +z, so forward
// is -z). A chop. It used to turn the other way, toward the face, which sent
// only because the chop had no direction (Lumenfold 5838; Nikk: "only a
// downard til, like a karate chop").
const rotationBy = (radians: number) => ({ x: Math.sin(-radians / 2), y: 0, z: 0, w: Math.cos(-radians / 2) });
/** The same swing the other way: fingertips tipping back toward the face. */
const backwardBy = (radians: number) => ({ x: Math.sin(radians / 2), y: 0, z: 0, w: Math.cos(radians / 2) });
// About y, the fingers of an upright hand: turning left or right.
const turnBy = (radians: number) => ({ x: 0, y: Math.sin(radians / 2), z: 0, w: Math.cos(radians / 2) });
// About z: the fingers leaning over toward the palm side.
const tipBy = (radians: number) => ({ x: 0, y: 0, z: Math.sin(radians / 2), w: Math.cos(radians / 2) });

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

  it("does not send when the fingers tip back toward the face (Nikk, 2026-09-28: only a downward chop)", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    const state = startGesture();
    const back = stepMicGesture(state, hands(openHand(backwardBy(deg(40)))), true, 2_000);
    expect(back.action).toBeUndefined();
    expect(stepMicGesture(back.state, hands(openHand(backwardBy(deg(40)))), true, 2_400).action).toBeUndefined();
    // The same size of swing forward sends.
    expect(stepMicGesture(startGesture(), hands(openHand(rotationBy(deg(40)))), true, 2_000).action).toBe("finish");
  });

  /** Nikk (5135): only a downward chop sends; turning to either side cancels. */
  it("sends only on a chop, and cancels when the hand turns left or right or tips over instead", () => {
    const deg = (d: number) => (d * Math.PI) / 180;
    // Turning 40° either way does not send: it throws the words away, once held.
    for (const way of [1, -1]) {
      const state = startGesture();
      const turned = stepMicGesture(state, hands(openHand(turnBy(way * deg(40)))), true, 2_000);
      expect(turned.action).toBeUndefined();
      expect(stepMicGesture(turned.state, hands(openHand(turnBy(way * deg(40)))), true, 2_200).action).toBe("cancel");
    }
    // Tipping sideways cancels too.
    const tipped = stepMicGesture(startGesture(), hands(openHand(tipBy(deg(40)))), true, 2_000);
    expect(stepMicGesture(tipped.state, hands(openHand(tipBy(deg(40)))), true, 2_200).action).toBe("cancel");
    // A single wrong-way frame is not enough: tracking blinks.
    const blink = stepMicGesture(startGesture(), hands(openHand(turnBy(deg(40)))), true, 2_000);
    const back = stepMicGesture(blink.state, hands(openHand()), true, 2_050);
    expect(back.action).toBeUndefined();
    expect(stepMicGesture(back.state, hands(openHand(rotationBy(deg(35)))), true, 2_300).action).toBe("finish");
    // A small turn while chopping still sends.
    const wobble = { ...rotationBy(deg(35)) };
    const mixed = openHand(wobble);
    const sent = stepMicGesture(startGesture(), hands({ ...mixed, palmNormal: turn(turnBy(deg(8)), mixed.palmNormal!) }), true, 2_000);
    expect(sent.action).toBe("finish");
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

    it("turns away a finger only a little bent, which used to count (Nikk, 6216)", () => {
      const joints: ({ x: number; y: number; z: number } | null)[] = Array.from({ length: 25 }, () => null);
      const finger = (base: number, x: number, slightly: boolean) => {
        joints[base] = { x, y: 0, z: 0 };
        joints[base + 1] = { x, y: 0.06, z: 0 };
        joints[base + 2] = slightly ? { x, y: 0.095, z: -0.012 } : { x, y: 0.1, z: 0 };
        // About 0.93 straight: over the old 0.9, under the new 0.94.
        joints[base + 4] = slightly ? { x, y: 0.115, z: -0.038 } : { x, y: 0.13, z: 0 };
      };
      [5, 10, 15, 20].forEach((base, i) => finger(base, i * 0.02, false));
      expect(fingersStraight(joints)).toBe(true);
      finger(10, 0.02, true);
      expect(fingersStraight(joints)).toBe(false);
    });

    it("starts only with the palm facing IN, like half of praying hands, on either hand (Nikk, 5117)", () => {
      // Thumb toward you, little finger away, fingers up, in front of the face.
      const joints = (thumbTowardYou: boolean, x: number) => {
        const j: ({ x: number; y: number; z: number } | null)[] = Array.from({ length: 25 }, () => null);
        const toward = thumbTowardYou ? 1 : -1;
        j[0] = { x, y: 1, z: 0 };
        j[6] = { x, y: 1.09, z: 0.02 * toward };
        j[11] = { x, y: 1.1, z: 0 };
        j[21] = { x, y: 1.08, z: -0.04 * toward };
        return j;
      };
      for (const x of [-0.08, 0.08]) {
        const praying = { ...openHand(identity, x), palmNormal: palmNormalOf(joints(true, x)) };
        expect(startPoseProblem(praying), `praying at x=${x}`).toBeNull();
        const out = { ...openHand(identity, x), palmNormal: palmNormalOf(joints(false, x)) };
        expect(startPoseProblem(out), `facing out at x=${x}`).toBe("palm facing out");
      }
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

  describe("a mostly closed hand cancels (Nikk, 5044: '80% of the way to a closed fist')", () => {
    // Wrist at the origin, knuckles 9 cm up; each finger's tip at `reach` from the wrist.
    const hand = (reach: number) => {
      const joints: ({ x: number; y: number; z: number } | null)[] = Array.from({ length: 25 }, () => null);
      joints[0] = { x: 0, y: 0, z: 0 };
      [6, 11, 16, 21].forEach((knuckle, i) => {
        joints[knuckle] = { x: i * 0.02, y: 0.09, z: 0 };
        joints[knuckle + 3] = { x: i * 0.02, y: reach, z: 0.02 };
      });
      return joints;
    };
    it("an open hand is not closed", () => expect(mostlyClosed(hand(0.18))).toBe(false));
    it("four fifths of a fist is closed: tips barely past the knuckles", () => expect(mostlyClosed(hand(0.1))).toBe(true));
    it("a tracking dropout is never closed", () => expect(mostlyClosed([])).toBe(false));

    it("a hand losing tracking, every joint piled on the wrist, is not closed (5070)", () => {
      const collapsed = Array.from({ length: 25 }, () => ({ x: 0, y: 0.01, z: 0 }));
      expect(closedness(collapsed)).toBe(0);
      expect(mostlyClosed(collapsed)).toBe(false);
    });

    it("closedness rises as the hand closes, for the bar to fade", () => {
      expect(closedness(hand(0.18))).toBe(0);
      const half = closedness(hand(0.14));
      expect(half).toBeGreaterThan(0);
      expect(half).toBeLessThan(1);
      expect(closedness(hand(0.1))).toBe(1);
    });

    it("reports the tilt toward sending and the closing toward cancelling separately", () => {
      const recording = startGesture();
      const halfway = stepMicGesture(recording, hands(openHand(rotationBy(MIC_GESTURE_TILT_RADIANS / 2))), true, 2_000);
      expect(halfway.tilt).toBeCloseTo(0.5, 1);
      expect(halfway.closing).toBe(0);
      const curling = stepMicGesture(recording, hands({ ...openHand(), closedness: 0.6 }), true, 2_000);
      expect(curling.tilt).toBeCloseTo(0, 6);
      expect(curling.closing).toBe(0.6);
      const sent = stepMicGesture(recording, hands(openHand(rotationBy(MIC_GESTURE_TILT_RADIANS))), true, 2_000);
      expect([sent.action, sent.tilt]).toEqual(["finish", 1]);
    });

    it("says what it measured when it starts, for the server log", () => {
      const line = describeStart("right", openHand());
      expect(line).toMatch(/^voice gesture started \(right hand\): palm in, 0° from edge-on \(limit 35\), fingers 0° from up, 0° from ahead/);
      // A high five: turned all the way from edge-on, which is why it is refused.
      expect(startPoseMeasures({ ...openHand(), palmNormal: { x: 0, y: 0, z: -1 } })!.fromEdgeOn).toBeCloseTo(90, 0);
    });

    it("cancels a recording once held briefly, even when the tracker calls it open", () => {
      const recording = startGesture();
      const half = { ...openHand(), closed: true, closedness: 1 };
      const first = stepMicGesture(recording, hands(half), true, 2_000);
      expect(first.action).toBeUndefined();
      expect(stepMicGesture(first.state, hands(half), true, 2_000 + MIC_GESTURE_FIST_HOLD_MS).action).toBe("cancel");
    });
  });
});
