import type { MicGestureHand, MicGestureSide } from "./mic-gesture-input";

export const MIC_GESTURE_HOLD_MS = 500;
export const MIC_GESTURE_TILT_RADIANS = (30 * Math.PI) / 180;
/** Held this long, a mostly closed hand cancels: quick, but not a tracking blink (5070). */
export const MIC_GESTURE_FIST_HOLD_MS = 250;
export const MIC_GESTURE_TRACKING_GRACE_MS = 900;
const MIC_GESTURE_START_TIMEOUT_MS = 8_000;
/** Fingers within this of straight up. Was 40°, which let a hand at rest count. */
const START_UP_CONE_RADIANS = (25 * Math.PI) / 180;
/** In front of the face: within this of where the head faces, sideways. */
const START_FRONT_DEGREES = 45;
/** And at a reach, not across the room, and between chest and a little over the head. */
const START_MAX_REACH_METRES = 0.9;
const START_LOWEST_BELOW_HEAD_METRES = 0.45;
const START_HIGHEST_ABOVE_HEAD_METRES = 0.3;
/** Edge-on like a chop: the palm faces sideways, at most this far toward or away from you. */
const START_EDGE_ON_DEGREES = 35;
const START_STILL_DISTANCE_METRES = 0.04;
const START_STILL_ANGLE_RADIANS = (12 * Math.PI) / 180;

export type MicGestureHands = Readonly<Record<MicGestureSide, MicGestureHand | null>>;
export type MicGestureAction = "start" | "finish" | "cancel";

export type MicGestureState =
  | { phase: "idle" }
  | { phase: "arming"; side: MicGestureSide; since: number; position: MicGestureHand["wrist"]["p"]; rotation: MicGestureHand["wrist"]["q"] }
  | { phase: "starting"; side: MicGestureSide; since: number; rotation: MicGestureHand["wrist"]["q"] }
  | { phase: "blocked" }
  | {
      phase: "recording";
      side: MicGestureSide | null;
      rotation: MicGestureHand["wrist"]["q"] | null;
      /** The hand's own directions when recording began: see chopOf. */
      frame?: HandFrame | null;
      /** Turned or tipped the wrong way long enough to cancel: see MIC_GESTURE_WRONG_WAY. */
      wrongSince?: number | null;
      fistSince: number | null;
      missingSince: number | null;
    }
  | { phase: "ending"; side: MicGestureSide | null };

export const IDLE_MIC_GESTURE: MicGestureState = { phase: "idle" };

function distance(a: MicGestureHand["wrist"]["p"], b: MicGestureHand["wrist"]["p"]) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function rotationDistance(a: MicGestureHand["wrist"]["q"], b: MicGestureHand["wrist"]["q"]) {
  const aLength = Math.hypot(a.x, a.y, a.z, a.w) || 1;
  const bLength = Math.hypot(b.x, b.y, b.z, b.w) || 1;
  const dot = Math.abs((a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w) / (aLength * bLength));
  return 2 * Math.acos(Math.min(1, dot));
}

/** Where the fingers point and which way the palm faces, both unit vectors. */
export type HandFrame = { fingers: Point; palm: Point };
type Point = { x: number; y: number; z: number };
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y + a.z * b.z;
const minus = (a: Point, b: Point, k: number): Point => ({ x: a.x - b.x * k, y: a.y - b.y * k, z: a.z - b.z * k });
const unit = (a: Point): Point | null => {
  const length = Math.hypot(a.x, a.y, a.z);
  return length > 1e-6 ? { x: a.x / length, y: a.y / length, z: a.z / length } : null;
};
const angleBetween = (a: Point, b: Point) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

export function handFrame(hand: MicGestureHand): HandFrame | null {
  const fingers = unit(hand.fingerDirection);
  const palm = hand.palmNormal ? unit(hand.palmNormal) : null;
  return fingers && palm ? { fingers, palm } : null;
}

/**
 * HOW THE HAND HAS MOVED SINCE RECORDING BEGAN, in three parts, radians.
 *
 * Nikk (5135): "the message sent ... should only happen when you make a
 * downward karate chop motion ... if you rotate your hand to either side it
 * should cancel". Any 30° of wrist rotation used to send. Measured from the
 * hand itself — where the fingers point, which way the palm faces:
 *
 *   chop   the flat hand swinging within its own plane, fingertips tipping
 *          forward and down: fingers move, the palm keeps facing the same way.
 *   turn   the hand turning left or right about the fingers (for an upright
 *          hand, about the vertical): the fingers stay, the palm swings round.
 *   tip    the fingers leaning over toward the palm side or the back.
 */
export function chopOf(start: HandFrame, now: HandFrame): { chop: number; turn: number; tip: number } {
  const tip = Math.asin(Math.min(1, Math.abs(dot(now.fingers, start.palm))));
  const inPlane = unit(minus(now.fingers, start.palm, dot(now.fingers, start.palm)));
  const chop = inPlane ? angleBetween(start.fingers, inPlane) : 0;
  const palmThen = unit(minus(start.palm, start.fingers, dot(start.palm, start.fingers)));
  const palmNow = unit(minus(now.palm, start.fingers, dot(now.palm, start.fingers)));
  const turn = palmThen && palmNow ? angleBetween(palmThen, palmNow) : 0;
  return { chop, turn, tip };
}

/** A chop must clearly outweigh any turn or tip to send. */
const CHOP_DOMINANCE = 1.5;
/** Turned or tipped this far the wrong way, for this long, cancels. */
export const MIC_GESTURE_WRONG_WAY_RADIANS = (30 * Math.PI) / 180;
export const MIC_GESTURE_WRONG_WAY_MS = 150;

/**
 * What the start pose is judged on, measured, so a start that should not have
 * happened can be read back from the server log rather than guessed at (Nikk,
 * 5111: a hand "facing flat out ... also pops up"). Angles in degrees.
 */
export type StartPoseMeasures = {
  /** How far the fingers are from straight up. */
  fromUp: number;
  /** Wrist from the head, metres, and how far above (+) or below (-) it. */
  reach: number;
  height: number;
  /** How far round from straight ahead of the face, level. */
  fromAhead: number;
  /** How far the palm is turned from edge-on toward facing you or away (0 is a chop). */
  fromEdgeOn: number;
  /**
   * Whether the palm faces IN, toward the middle of you, like half of a pair
   * of praying hands, rather than out to the side. Nikk (5117): "palm facing
   * in like half of a prayer hands"; a palm facing out used to start it too.
   */
  palmIn: boolean;
};

export function startPoseMeasures(hand: MicGestureHand): StartPoseMeasures | null {
  if (!hand.head || !hand.palmNormal) return null;
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  const direction = hand.fingerDirection;
  const directionLength = Math.hypot(direction.x, direction.y, direction.z) || 1;
  // Where the head faces, level: -z turned by the head's rotation.
  const { x: qx, y: qy, z: qz, w: qw } = hand.head.q;
  const fx = -2 * (qx * qz + qw * qy), fz = -(1 - 2 * (qx * qx + qy * qy));
  const forward = Math.hypot(fx, fz) || 1e-9;
  const to = { x: hand.wrist.p.x - hand.head.p.x, y: hand.wrist.p.y - hand.head.p.y, z: hand.wrist.p.z - hand.head.p.z };
  const level = Math.hypot(to.x, to.z) || 1e-9;
  // Edge-on: the palm faces left or right of the line from you to the hand,
  // not along it (a high five faces away; a wave faces you).
  const facing = Math.min(1, Math.abs((hand.palmNormal.x * to.x + hand.palmNormal.z * to.z) / level));
  // IN OR OUT. palmNormalOf is a cross product of the knuckles and the hand's
  // length, so it comes out of the palm of a left hand and the back of a
  // right one. Held up edge-on with the thumb toward you (a praying hand),
  // both point to your right; turned to face out, both point to your left.
  // So one rule serves both hands: the normal on your right side is in.
  const rightX = -fz / forward, rightZ = fx / forward;
  return {
    fromUp: degrees(Math.acos(Math.max(-1, Math.min(1, direction.y / directionLength)))),
    reach: Math.hypot(to.x, to.y, to.z),
    height: to.y,
    fromAhead: degrees(Math.acos(Math.max(-1, Math.min(1, (to.x * fx + to.z * fz) / (level * forward))))),
    fromEdgeOn: degrees(Math.asin(facing)),
    palmIn: hand.palmNormal.x * rightX + hand.palmNormal.z * rightZ > 0,
  };
}

/**
 * THE START POSE, as Nikk described it (4979, 4987, 5004): "a karate chop not
 * ... like give me five", "completely straight and pointing almost completely
 * up", "relatively in front of your face", "like one hand praying". Each rule
 * below turns away a hand that was starting recordings by itself: a half-open
 * fist, a hand held up to the side, a palm facing forward.
 *
 * Exported for tests: the reason a hand is not a start pose, or null when it is.
 */
export function startPoseProblem(hand: MicGestureHand | null): string | null {
  if (!hand) return "no hand";
  if (hand.shape !== "open" || !hand.straight) return "not flat";
  const directionLength = Math.hypot(hand.fingerDirection.x, hand.fingerDirection.y, hand.fingerDirection.z);
  if (!directionLength || hand.fingerDirection.y / directionLength < Math.cos(START_UP_CONE_RADIANS)) return "not pointing up";
  const measured = startPoseMeasures(hand);
  if (!measured) return "not tracked";
  if (measured.reach > START_MAX_REACH_METRES) return "too far away";
  if (measured.height < -START_LOWEST_BELOW_HEAD_METRES || measured.height > START_HIGHEST_ABOVE_HEAD_METRES) return "not at face height";
  const level = Math.hypot(hand.wrist.p.x - hand.head!.p.x, hand.wrist.p.z - hand.head!.p.z);
  if (level < 0.05 || measured.fromAhead > START_FRONT_DEGREES) return "not in front";
  if (measured.fromEdgeOn > START_EDGE_ON_DEGREES) return "palm not edge-on";
  if (!measured.palmIn) return "palm facing out";
  return null;
}

/** One line for the server log when the gesture starts: what was measured. */
export function describeStart(side: MicGestureSide, hand: MicGestureHand): string {
  const m = startPoseMeasures(hand);
  const palm = hand.palmNormal;
  return m && palm
    ? `voice gesture started (${side} hand): palm ${m.palmIn ? "in" : "OUT"}, ${m.fromEdgeOn.toFixed(0)}° from edge-on (limit ${START_EDGE_ON_DEGREES}), ` +
        `fingers ${m.fromUp.toFixed(0)}° from up, ${m.fromAhead.toFixed(0)}° from ahead, ${m.reach.toFixed(2)} m away, ` +
        `${m.height.toFixed(2)} m from head height; palm normal (${palm.x.toFixed(2)}, ${palm.y.toFixed(2)}, ${palm.z.toFixed(2)})`
    : `voice gesture started (${side} hand)`;
}

function isStartPose(hand: MicGestureHand | null): hand is MicGestureHand {
  return startPoseProblem(hand) === null;
}

function firstStartHand(hands: MicGestureHands): [MicGestureSide, MicGestureHand] | null {
  for (const side of ["left", "right"] as const) {
    const hand = hands[side];
    if (isStartPose(hand)) return [side, hand];
  }
  return null;
}

function activeRecording(
  side: MicGestureSide,
  hand: MicGestureHand,
  fistSince: number | null = null,
): MicGestureState {
  return {
    phase: "recording",
    side,
    rotation: hand.wrist.q,
    frame: handFrame(hand),
    wrongSince: null,
    fistSince,
    missingSince: null,
  };
}

/**
 * Step the opt-in mic gesture. Starting requires a stable upright open hand;
 * finishing uses the wrist's angular change from that captured start pose.
 * This is pure so timing, dropout, and one-shot behavior can be tested without
 * an XR runtime.
 */
export function stepMicGesture(
  previous: MicGestureState,
  hands: MicGestureHands,
  recording: boolean,
  now: number,
  enabled = true,
): {
  state: MicGestureState;
  action?: MicGestureAction;
  outlineSide: MicGestureSide | null;
  /** How far toward the tilt that sends, 0..1. */
  tilt?: number;
  /** How far toward the fist that throws the words away, 0..1. */
  closing?: number;
} {
  if (!enabled) return { state: IDLE_MIC_GESTURE, outlineSide: null };

  if (previous.phase === "starting") {
    if (recording) {
      const hand = hands[previous.side];
      return {
        state: {
          phase: "recording",
          side: previous.side,
          rotation: previous.rotation,
          frame: hand ? handFrame(hand) : null,
          wrongSince: null,
          fistSince: null,
          missingSince: hand ? null : now,
        },
        outlineSide: hand ? previous.side : null,
      };
    }
    if (now - previous.since >= MIC_GESTURE_START_TIMEOUT_MS) return { state: { phase: "blocked" }, outlineSide: null };
    return { state: previous, outlineSide: null };
  }

  if (previous.phase === "ending") {
    return recording
      ? { state: previous, outlineSide: previous.side }
      : { state: IDLE_MIC_GESTURE, outlineSide: null };
  }

  if (previous.phase === "blocked") {
    return !recording && !firstStartHand(hands)
      ? { state: IDLE_MIC_GESTURE, outlineSide: null }
      : { state: previous, outlineSide: null };
  }

  if (recording) {
    if (previous.phase !== "recording") {
      const candidate = firstStartHand(hands);
      return candidate
        ? { state: activeRecording(candidate[0], candidate[1]), outlineSide: candidate[0] }
        : { state: { phase: "recording", side: null, rotation: null, fistSince: null, missingSince: null }, outlineSide: null };
    }

    if (previous.side === null || previous.rotation === null) {
      const candidate = firstStartHand(hands);
      return candidate
        ? { state: activeRecording(candidate[0], candidate[1]), outlineSide: candidate[0] }
        : { state: previous, outlineSide: null };
    }

    const hand = hands[previous.side];
    if (!hand) {
      const missingSince = previous.missingSince ?? now;
      if (now - missingSince >= MIC_GESTURE_TRACKING_GRACE_MS) {
        return {
          state: { phase: "recording", side: null, rotation: null, fistSince: null, missingSince: null },
          outlineSide: null,
        };
      }
      return {
        state: { ...previous, missingSince },
        outlineSide: null,
      };
    }

    if (hand.closed || hand.shape === "fist") {
      const fistSince = previous.fistSince ?? now;
      if (now - fistSince >= MIC_GESTURE_FIST_HOLD_MS) {
        return { state: { phase: "ending", side: previous.side }, action: "cancel", outlineSide: previous.side, closing: 1 };
      }
      return { state: { ...previous, fistSince, missingSince: null }, outlineSide: previous.side, closing: 1 };
    }

    // The reference pose, taken on the first frame the hand is seen if it was
    // not seen when recording began.
    const frame = previous.frame ?? handFrame(hand);
    const current = handFrame(hand);
    if (!frame || !current) {
      return { state: { ...previous, frame, fistSince: null, missingSince: null }, outlineSide: previous.side, tilt: 0, closing: hand.closedness ?? 0 };
    }
    const { chop, turn, tip } = chopOf(frame, current);
    const wrongWay = Math.max(turn, tip);
    if (chop >= MIC_GESTURE_TILT_RADIANS - 1e-6 && chop >= wrongWay * CHOP_DOMINANCE) {
      return { state: { phase: "ending", side: previous.side }, action: "finish", outlineSide: previous.side, tilt: 1 };
    }
    // TURNED OR TIPPED, NOT CHOPPED: the words are thrown away (Nikk 5135).
    // Held briefly, so one bad tracking frame cannot cancel a recording.
    if (wrongWay >= MIC_GESTURE_WRONG_WAY_RADIANS) {
      const wrongSince = previous.wrongSince ?? now;
      if (now - wrongSince >= MIC_GESTURE_WRONG_WAY_MS) {
        return { state: { phase: "ending", side: previous.side }, action: "cancel", outlineSide: previous.side, closing: 1 };
      }
      return { state: { ...previous, frame, wrongSince, fistSince: null, missingSince: null }, outlineSide: previous.side, tilt: 0, closing: wrongWay / (MIC_GESTURE_WRONG_WAY_RADIANS * 2) };
    }
    const tilt = chop;
    return {
      state: { ...previous, frame, wrongSince: null, fistSince: null, missingSince: null },
      outlineSide: previous.side,
      // Both, separately: the bar brightens toward the tilt that sends and
      // fades toward the fist that drops (MicGestureBar).
      tilt: tilt / MIC_GESTURE_TILT_RADIANS,
      closing: hand.closedness ?? 0,
    };
  }

  if (previous.phase === "recording") return { state: IDLE_MIC_GESTURE, outlineSide: null };

  if (previous.phase === "arming") {
    const hand = hands[previous.side];
    if (!isStartPose(hand)) {
      const next = firstStartHand(hands);
      return next
        ? {
            state: { phase: "arming", side: next[0], since: now, position: next[1].wrist.p, rotation: next[1].wrist.q },
            outlineSide: null,
          }
        : { state: IDLE_MIC_GESTURE, outlineSide: null };
    }
    const moved = distance(previous.position, hand.wrist.p) > START_STILL_DISTANCE_METRES;
    const turned = rotationDistance(previous.rotation, hand.wrist.q) > START_STILL_ANGLE_RADIANS;
    if (moved || turned) {
      return {
        state: { phase: "arming", side: previous.side, since: now, position: hand.wrist.p, rotation: hand.wrist.q },
        outlineSide: null,
      };
    }
    if (now - previous.since >= MIC_GESTURE_HOLD_MS) {
      return { state: { phase: "starting", side: previous.side, since: now, rotation: hand.wrist.q }, action: "start", outlineSide: null };
    }
    return { state: previous, outlineSide: null };
  }

  const candidate = firstStartHand(hands);
  return candidate
    ? {
        state: { phase: "arming", side: candidate[0], since: now, position: candidate[1].wrist.p, rotation: candidate[1].wrist.q },
        outlineSide: null,
      }
    : { state: IDLE_MIC_GESTURE, outlineSide: null };
}
