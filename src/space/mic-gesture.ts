import type { MicGestureHand, MicGestureSide } from "./mic-gesture-input";

export const MIC_GESTURE_HOLD_MS = 500;
export const MIC_GESTURE_TILT_RADIANS = (30 * Math.PI) / 180;
export const MIC_GESTURE_FIST_HOLD_MS = 180;
export const MIC_GESTURE_TRACKING_GRACE_MS = 900;
const MIC_GESTURE_START_TIMEOUT_MS = 8_000;
const START_UP_CONE_RADIANS = (40 * Math.PI) / 180;
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

function isStartPose(hand: MicGestureHand | null): hand is MicGestureHand {
  if (!hand || hand.shape !== "open") return false;
  const directionLength = Math.hypot(hand.fingerDirection.x, hand.fingerDirection.y, hand.fingerDirection.z);
  if (!directionLength) return false;
  return hand.fingerDirection.y / directionLength >= Math.cos(START_UP_CONE_RADIANS);
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
): { state: MicGestureState; action?: MicGestureAction; outlineSide: MicGestureSide | null } {
  if (!enabled) return { state: IDLE_MIC_GESTURE, outlineSide: null };

  if (previous.phase === "starting") {
    if (recording) {
      const hand = hands[previous.side];
      return {
        state: {
          phase: "recording",
          side: previous.side,
          rotation: previous.rotation,
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

    if (hand.shape === "fist") {
      const fistSince = previous.fistSince ?? now;
      if (now - fistSince >= MIC_GESTURE_FIST_HOLD_MS) {
        return { state: { phase: "ending", side: previous.side }, action: "cancel", outlineSide: previous.side };
      }
      return { state: { ...previous, fistSince, missingSince: null }, outlineSide: previous.side };
    }

    if (rotationDistance(previous.rotation, hand.wrist.q) >= MIC_GESTURE_TILT_RADIANS - 1e-6) {
      return { state: { phase: "ending", side: previous.side }, action: "finish", outlineSide: previous.side };
    }
    return {
      state: { ...previous, fistSince: null, missingSince: null },
      outlineSide: previous.side,
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
