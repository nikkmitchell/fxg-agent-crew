import type { Point3 } from "../../shared/go-layout";
import type { Pose } from "../../shared/space-wire";

export const MIC_GESTURE_JOINT_NAMES = [
  "wrist",
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  "index-finger-metacarpal", "index-finger-phalanx-proximal", "index-finger-phalanx-intermediate", "index-finger-phalanx-distal", "index-finger-tip",
  "middle-finger-metacarpal", "middle-finger-phalanx-proximal", "middle-finger-phalanx-intermediate", "middle-finger-phalanx-distal", "middle-finger-tip",
  "ring-finger-metacarpal", "ring-finger-phalanx-proximal", "ring-finger-phalanx-intermediate", "ring-finger-phalanx-distal", "ring-finger-tip",
  "pinky-finger-metacarpal", "pinky-finger-phalanx-proximal", "pinky-finger-phalanx-intermediate", "pinky-finger-phalanx-distal", "pinky-finger-tip",
] as const;

/** Knuckles and tips are enough to recognize a pose; the rest are fetched only for the glow. */
export const MIC_GESTURE_POSTURE_JOINT_INDICES = [5, 9, 10, 14, 15, 19, 20, 24] as const;
export const MIC_GESTURE_DRAW_JOINT_INDICES = MIC_GESTURE_JOINT_NAMES.map((_, index) => index).filter((index) => index !== 0);

export type MicGestureSide = "left" | "right";
export type MicGestureShape = "open" | "fist" | "other";
export type MicGestureHand = {
  /** Wrist pose and joint points are in the XR player's local frame. */
  wrist: Pose;
  /** Direction from the index knuckle toward its fingertip, normalized. */
  fingerDirection: Point3;
  shape: MicGestureShape;
  /** Joint points follow MIC_GESTURE_JOINT_NAMES; unavailable joints are null. */
  joints: ReadonlyArray<Point3 | null>;
};

export const micGestureHands: Record<MicGestureSide, MicGestureHand | null> = {
  left: null,
  right: null,
};

/** The hand whose outline is currently shown while gesture recording is active. */
export const micGestureIndicator: { side: MicGestureSide | null } = { side: null };

export function clearMicGestureHands() {
  micGestureHands.left = null;
  micGestureHands.right = null;
  micGestureIndicator.side = null;
}

function distance(a: Point3, b: Point3) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Recognize only clear open/fist poses. Missing tracking data is "other", not
 * evidence of a fist, so a joint dropout can never cancel someone's recording.
 */
export function classifyMicHand(
  wrist: Point3 | null,
  bases: ReadonlyArray<Point3 | null>,
  tips: ReadonlyArray<Point3 | null>,
): MicGestureShape {
  if (!wrist || bases.length !== 4 || tips.length !== 4 || bases.some((point) => !point) || tips.some((point) => !point)) {
    return "other";
  }
  const extended = bases.reduce((count, base, index) => {
    const tip = tips[index];
    if (!base || !tip) return count;
    return count + (distance(wrist, tip) - distance(wrist, base) >= 0.04 ? 1 : 0);
  }, 0);
  if (extended >= 3) return "open";
  if (extended <= 1) return "fist";
  return "other";
}
