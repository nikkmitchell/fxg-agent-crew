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

/**
 * What a pose is judged on: each finger's base, its two middle joints and its
 * tip, so a finger can be told straight from bent (fingersStraight). The
 * distal joints are fetched only for the glow.
 */
export const MIC_GESTURE_POSTURE_JOINT_INDICES = [5, 6, 7, 9, 10, 11, 12, 14, 15, 16, 17, 19, 20, 21, 22, 24] as const;
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
  /** Every finger straight, not merely out: see fingersStraight. */
  straight: boolean;
  /** Out of the palm (either side), normalized, or null when not tracked. */
  palmNormal: Point3 | null;
  /** The viewer's head in the same frame, to judge "in front of your face". */
  head: Pose | null;
  /** Mostly closed, about 80% of a fist: see mostlyClosed. Cancels a recording. */
  closed: boolean;
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

const sub = (a: Point3, b: Point3): Point3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (v: Point3) => Math.hypot(v.x, v.y, v.z);

/**
 * EVERY FINGER STRAIGHT. Nikk (5004): "only when your hand is flat". "Open"
 * counted three fingertips a few centimetres past their knuckles, which a
 * half-open fist passes. Here each finger's joints must lie nearly on a line:
 * the straight distance base-to-tip against the length along its joints. A
 * straight finger is ~1; one bent at the knuckles falls well under.
 */
export const FINGER_STRAIGHT_RATIO = 0.9;
export function fingersStraight(joints: ReadonlyArray<Point3 | null>): boolean {
  for (const [base, proximal, intermediate, tip, need] of [
    [5, 6, 7, 9, FINGER_STRAIGHT_RATIO],
    [10, 11, 12, 14, FINGER_STRAIGHT_RATIO],
    [15, 16, 17, 19, FINGER_STRAIGHT_RATIO],
    // The little finger tracks worst; a little more give.
    [20, 21, 22, 24, FINGER_STRAIGHT_RATIO - 0.05],
  ] as const) {
    const chain = [joints[base], joints[proximal], joints[intermediate], joints[tip]];
    if (chain.some((point) => !point)) return false;
    const [a, b, c, d] = chain as Point3[];
    const along = length(sub(b, a)) + length(sub(c, b)) + length(sub(d, c));
    if (along < 1e-4 || length(sub(d, a)) / along < need) return false;
  }
  return true;
}

/** Out of the palm: across the knuckles, crossed with wrist-to-middle-knuckle. */
export function palmNormalOf(joints: ReadonlyArray<Point3 | null>): Point3 | null {
  const wrist = joints[0], index = joints[6], middle = joints[11], pinky = joints[21];
  if (!wrist || !index || !middle || !pinky) return null;
  const across = sub(pinky, index), along = sub(middle, wrist);
  const n = {
    x: across.y * along.z - across.z * along.y,
    y: across.z * along.x - across.x * along.z,
    z: across.x * along.y - across.y * along.x,
  };
  const size = length(n);
  return size < 1e-6 ? null : { x: n.x / size, y: n.y / size, z: n.z / size };
}

/**
 * MOSTLY CLOSED, NOT A PERFECT FIST. Nikk (5044): "if it's like 80% of the way
 * to a closed fist it should automatically cancel". "fist" above needs fingers
 * whose tips are within 4 cm of their BASE joints, which sit at the wrist, so
 * it almost never fired. Here a finger is curled once its tip is no further
 * from the wrist than a little past its knuckle, which a four-fifths fist
 * already is; three curled fingers is closed. Missing joints are not closed,
 * so a tracking dropout never cancels anything.
 */
export const CURLED_PAST_KNUCKLE_METRES = 0.025;
export function mostlyClosed(joints: ReadonlyArray<Point3 | null>): boolean {
  const wrist = joints[0];
  if (!wrist) return false;
  let curled = 0;
  for (const [knuckle, tip] of [[6, 9], [11, 14], [16, 19], [21, 24]] as const) {
    const k = joints[knuckle], t = joints[tip];
    if (!k || !t) continue;
    if (length(sub(t, wrist)) - length(sub(k, wrist)) < CURLED_PAST_KNUCKLE_METRES) curled += 1;
  }
  return curled >= 3;
}
