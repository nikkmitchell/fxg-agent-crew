/**
 * FINGERS, AS A FEW ANGLES.
 *
 * Nikk: "can we have the player avatars hands be animated? ... we have the bone
 * positions from hand tracking, can we add that in, so that hand movement is
 * synced?" The wrist already crossed the wire; the fingers did not, so every
 * avatar's hands stayed flat in the model's rest pose whatever the person was
 * doing with them.
 *
 * WHY ANGLES AND NOT THE 25 JOINTS. A tracked hand is 25 joint poses; an
 * avatar's hand is 15 finger bones of a different length, in a different rest
 * pose, on a model that may be any size. Sending joint positions would make
 * every viewer solve that, and would be 25 poses a hand ten times a second.
 * How far each joint is BENT is what a hand shows, it is the same number on
 * any body, and it is 20 small numbers a hand.
 *
 * LAYOUT (radians, FINGER_ANGLES long, four a finger):
 *   thumb:                      which way its base bone points (out from the
 *                               fingers' line across the palm, and down out of
 *                               the palm's plane), then bend at its two knuckles
 *   index, middle, ring, little: spread at the knuckle, then bend at each of its
 *                               three knuckles, base first
 *
 * THE THUMB'S BASE is a direction rather than a bend, because it is what
 * swings the thumb across the palm into a fist or onto a fingertip in a pinch,
 * and a direction in the hand's own frame means the same thing on any model.
 *
 * BEND is toward the palm (a fist is large and positive; a finger bent back is
 * slightly negative). SPREAD turns about the palm's normal, right-handed; the
 * same side of the hand gives the same sign on the headset and on the model,
 * so it needs no mirroring between left and right.
 *
 * The frame the angles are measured in is the hand's own: `finger` is the way
 * the fingers point with the hand flat and `palm` is out of the palm. A WebXR
 * wrist has -Z toward the fingers and -Y out of the palm; a model measures its
 * own (tracked-body.ts `measureRig`). Pure: no three.js, so the server can
 * check it and a test can prove it.
 */
export type V3 = { x: number; y: number; z: number };

export const FINGER_ANGLES = 20;

/** Largest bend and spread a hand can make, a little past the real limits. */
const BEND_MIN = -0.6, BEND_MAX = 2.0, SPREAD_MAX = 0.6;
/** Knuckle bends between which a finger's spread fades from all to none. */
const SPREAD_FULL = (20 * Math.PI) / 180, SPREAD_NONE = (60 * Math.PI) / 180;

/**
 * The WebXR joints the angles are read from, in the order `fingerAngles`
 * expects them: the thumb's four, then each finger's five, base to tip.
 */
export const FINGER_JOINT_NAMES = [
  "thumb-metacarpal", "thumb-phalanx-proximal", "thumb-phalanx-distal", "thumb-tip",
  ...(["index", "middle", "ring", "pinky"] as const).flatMap((finger) => [
    `${finger}-finger-metacarpal`,
    `${finger}-finger-phalanx-proximal`,
    `${finger}-finger-phalanx-intermediate`,
    `${finger}-finger-phalanx-distal`,
    `${finger}-finger-tip`,
  ]),
] as const;

const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const length = (a: V3) => Math.hypot(a.x, a.y, a.z);
const unit = (a: V3): V3 => scale(a, 1 / (length(a) || 1));
/** `a` with its part along the unit `axis` removed. */
const flatten = (a: V3, axis: V3): V3 => sub(a, scale(axis, dot(a, axis)));

/**
 * The axis a thumb bone curls about: toward the palm side and toward the index
 * fingers at once, which is the way a thumb closes. Built the same way from the
 * headset's joints and from a model's rest bones, so one angle means one curl
 * on any body. `acrossPalm` runs from the index knuckle to the little one.
 */
export function thumbCurlAxis(bone: V3, palm: V3, acrossPalm: V3): V3 {
  const along = unit(bone);
  const target = unit(add(unit(palm), unit(acrossPalm)));
  const axis = cross(along, flatten(target, along));
  return length(axis) > 1e-9 ? unit(axis) : unit(cross(along, palm));
}

/** The turn from `a` to `b` about the unit `axis`, looking only across it. */
function turnAbout(a: V3, b: V3, axis: V3): number {
  const fa = flatten(a, axis), fb = flatten(b, axis);
  if (length(fa) < 1e-9 || length(fb) < 1e-9) return 0;
  return Math.atan2(dot(cross(fa, fb), axis), dot(fa, fb));
}

const clamp = (v: number, low: number, high: number) => Math.min(high, Math.max(low, v));
const bend = (v: number) => clamp(v, BEND_MIN, BEND_MAX);

/**
 * The angles of a tracked hand. `joints` are FINGER_JOINT_NAMES' positions in
 * one frame (any frame, as long as `finger` and `palm` are in it too); null if
 * any is missing, because half a hand's angles would pose a hand nobody made.
 */
export function fingerAngles(joints: ReadonlyArray<V3 | null>, finger: V3, palm: V3): number[] | null {
  if (joints.length !== FINGER_JOINT_NAMES.length || joints.some((joint) => joint === null)) return null;
  const at = joints as ReadonlyArray<V3>;
  const f = unit(finger);
  const p = unit(flatten(palm, f));
  // The hand's own sideways axis: a bend toward the palm turns about it.
  const across = cross(f, p);
  const out: number[] = [];

  // THE THUMB: where its base bone points, in the hand's frame, and then its
  // bends, each about the thumb's own sideways axis, since it lies across the
  // palm at an angle rather than along it.
  const thumb = [sub(at[1], at[0]), sub(at[2], at[1]), sub(at[3], at[2])];
  const thumbBase = unit(thumb[0]);
  out.push(Math.atan2(dot(thumbBase, across), dot(thumbBase, f)), Math.asin(clamp(dot(thumbBase, p), -1, 1)));
  // Each thumb knuckle's bend is the WHOLE angle between its bones, signed by
  // whether it curls the tip toward its curl target (thumbCurlAxis). Measured
  // only square to the palm, as the fingers are, it missed the thumb: the thumb
  // lies turned across the palm and flexes mostly within its plane, so its top
  // bone read nearly straight however far it curled (Nikk, 7223: "the top
  // thumbbone doesn't move anything", on every avatar).
  // Across the palm, index knuckle to little knuckle: one direction however far the thumb has curled.
  const acrossPalm = sub(at[20], at[5]);
  for (let i = 0; i < 2; i++) {
    const a = thumb[i], b = thumb[i + 1];
    const turn = cross(a, b);
    const angle = Math.atan2(length(turn), dot(a, b));
    out.push(bend(dot(turn, thumbCurlAxis(a, p, acrossPalm)) >= 0 ? angle : -angle));
  }

  for (let finger = 0; finger < 4; finger++) {
    const base = 4 + finger * 5;
    const bones = [0, 1, 2, 3].map((i) => sub(at[base + i + 1], at[base + i]));
    const bends = [0, 1, 2].map((i) => bend(turnAbout(bones[i], bones[i + 1], across)));
    // SPREAD is read in the palm's plane, and ONLY WHILE THE FINGER IS MOSTLY
    // STRAIGHT. A finger curling into the palm has little left in that plane,
    // and what is left is noise that reads as a big sideways angle: Nikk's
    // fists arrived with ring and little spread at the 34° limit (recorded
    // live, 2026-09-27), and turning a curled finger that far about the palm
    // swings it across its neighbours — "other people see them moving
    // strangely" (5142). A real fist does not spread, so full spread up to
    // SPREAD_FULL of knuckle bend, none past SPREAD_NONE.
    const straight = clamp((SPREAD_NONE - bends[0]) / (SPREAD_NONE - SPREAD_FULL), 0, 1);
    out.push(clamp(turnAbout(bones[0], bones[1], p) * straight, -SPREAD_MAX, SPREAD_MAX));
    out.push(...bends);
  }
  return out;
}

/** Rounded for the wire: a hundredth of a radian is under a degree. */
export const fingersForWire = (angles: number[]): number[] => angles.map((a) => Math.round(a * 100) / 100);

/**
 * Finger angles from the wire, or undefined for anything that is not exactly
 * that. Clamped rather than refused: an angle a little past a knuckle's limit
 * is still a hand, and the wrist beside it is still good.
 */
export function parseFingers(value: unknown): number[] | undefined {
  if (!Array.isArray(value) || value.length !== FINGER_ANGLES) return undefined;
  if (!value.every((v) => typeof v === "number" && Number.isFinite(v))) return undefined;
  return (value as number[]).map((v, i) => {
    if (i === 0) return clamp(v, -Math.PI, Math.PI);
    if (i === 1) return clamp(v, -Math.PI / 2, Math.PI / 2);
    return isSpread(i) ? clamp(v, -SPREAD_MAX, SPREAD_MAX) : bend(v);
  });
}

/** Whether slot `i` of the layout is a finger's spread. */
export const isSpread = (i: number) => i >= 4 && i % 4 === 0;
/** Whether slot `i` of the layout is a bend at a knuckle. */
export const isBend = (i: number) => i >= 2 && !isSpread(i);
