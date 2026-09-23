/**
 * Picking a thing up and carrying it, the way a headset does it.
 *
 * WHAT WAS WRONG, IN NIKK'S WORDS: "the drags for movement are very strange,
 * like when you start dragging a board is pulled right to where you are".
 *
 * That was not a feel problem, it was arithmetic. A drag used to be a ray cast
 * at a LEVEL PLANE AT THE PANEL'S OWN HEIGHT — eye height is 1.62 and panels
 * hang at 1.65, a gap of three centimetres — so the ray met the plane at a
 * grazing angle and the hit point ran away with it:
 *
 *   pitch above level     where the panel went
 *      0.5°                3.4 m away
 *      1.0°                1.7 m
 *      2.0°                0.9 m
 *      5.0°                0.3 m  — at your feet
 *
 * One degree of mouse movement was nearly a metre of travel, the panel could
 * never be put further away than a few metres, and looking a hair BELOW level
 * meant the ray missed the plane entirely and the panel stopped dead. Every
 * one of those is the same mistake, and no amount of smoothing fixes it.
 *
 * SO THE THING KEEPS ITS DISTANCE. You grab it where it is, it stays that far
 * along your ray, and it goes where you point: left, right, up, down. Coming
 * closer or going further away is a SEPARATE, DELIBERATE input — a wheel, a
 * thumbstick — because that is the one direction a ray cannot express, and
 * guessing at it from a two-dimensional gesture is what caused all this.
 *
 * NO RENDERER IN HERE. Every number below can be checked with arithmetic, and
 * the bug this replaces was pure arithmetic that no screenshot would have
 * settled.
 */

export type Vec3 = { x: number; y: number; z: number };

/** Where a pointer is pointing. A mouse builds one from the camera; a controller has one already. */
export type Ray = { origin: Vec3; direction: Vec3 };

export type Grab = {
  /** How far along the ray it rides. Kept as you point around, changed only by pushing or pulling. */
  distance: number;
  /**
   * Where it sits relative to the ray, IN THE RAY'S OWN FRAME — right, up, and
   * forward of where the ray reaches, rather than a fixed offset in the room.
   *
   * This is what stops a panel snapping its own centre onto the pointer the
   * instant you touch it: grab a board by its corner and it stays held by that
   * corner. Carrying it in the ray's frame rather than the world's is the
   * difference between a thing held in your hand and a thing dragged on a
   * string — a four-metre panel grabbed at its edge has a two-metre offset,
   * and in world coordinates that offset would swing it wildly as you turned,
   * which is a quieter version of the very bug this file exists to fix.
   */
  offset: { right: number; up: number; forward: number };
};

/**
 * How near and how far a thing may be carried.
 *
 * Nearer than `nearest` it is inside your face and fills the view; further than
 * `furthest` it is across the room and too small to have been aimed at
 * deliberately. Both ends are reachable by pushing and pulling, which is the
 * rule the panel scale limits already follow: never move a thing somewhere it
 * cannot be brought back from.
 */
export const REACH = { nearest: 0.9, furthest: 12 } as const;

const length = (v: Vec3) => Math.hypot(v.x, v.y, v.z);
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** A unit direction. A zero ray points straight ahead rather than producing NaNs. */
export function unit(v: Vec3): Vec3 {
  const l = length(v);
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: -1 };
}

/**
 * The ray's own axes: where forward, right and up are for somebody pointing it.
 *
 * Straight up and straight down have no "right" of their own, so they borrow
 * one. Without that the basis collapses and everything held becomes NaN at the
 * exact moment somebody looks at the ceiling.
 */
function frame(direction: Vec3): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = unit(direction);
  const reference = Math.abs(forward.y) > 0.999 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };
  const right = unit(cross(forward, reference));
  const up = cross(right, forward);
  return { forward, right, up };
}

export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Take hold of something at `at`, along `ray`.
 *
 * The distance is measured ALONG THE RAY rather than straight to the thing, so
 * that pointing back at it reproduces exactly where it was — see `grabbedTo`,
 * which is the inverse of this and is tested as one.
 */
export function beginGrab(ray: Ray, at: Vec3, limits: { nearest: number; furthest: number } = REACH): Grab {
  const { forward, right, up } = frame(ray.direction);
  const toIt = { x: at.x - ray.origin.x, y: at.y - ray.origin.y, z: at.z - ray.origin.z };
  const distance = clamp(dot(toIt, forward), limits.nearest, limits.furthest);
  const spare = {
    x: toIt.x - forward.x * distance,
    y: toIt.y - forward.y * distance,
    z: toIt.z - forward.z * distance,
  };
  return {
    distance,
    offset: { right: dot(spare, right), up: dot(spare, up), forward: dot(spare, forward) },
  };
}

/** Where the held thing goes, now that the ray points here. */
export function grabbedTo(ray: Ray, grab: Grab): Vec3 {
  const { forward, right, up } = frame(ray.direction);
  const out = grab.distance + grab.offset.forward;
  return {
    x: ray.origin.x + forward.x * out + right.x * grab.offset.right + up.x * grab.offset.up,
    y: ray.origin.y + forward.y * out + right.y * grab.offset.right + up.y * grab.offset.up,
    z: ray.origin.z + forward.z * out + right.z * grab.offset.right + up.z * grab.offset.up,
  };
}

/**
 * Push it away or pull it in, without moving it across your view.
 *
 * `by` is in metres, signed: positive pushes away. The offset is deliberately
 * untouched — this is the one axis a ray cannot say anything about, so it is
 * the one axis this changes.
 */
export function pushPull(grab: Grab, by: number, limits: { nearest: number; furthest: number } = REACH): Grab {
  return { ...grab, distance: clamp(grab.distance + by, limits.nearest, limits.furthest) };
}

/**
 * How steeply a ray must meet a level plane before the answer is worth having.
 *
 * THIS CONSTANT IS THE BUG, WRITTEN DOWN. Below this angle the hit point is so
 * far away, and moves so fast, that it is noise rather than an intention. A
 * grazing ray is a MISS, and a thing that stays put is better than a thing
 * that leaps across the room.
 *
 * 0.12 is about seven degrees: from standing eye height that puts the furthest
 * usable hit on the floor at roughly thirteen metres, which is past the far
 * wall.
 */
export const GRAZING = 0.12;

/**
 * Where a ray meets a level plane, or null if it never usefully does.
 *
 * This is for things that live ON THE FLOOR — a table is furniture, and
 * furniture that can be lifted into the air by pointing upward is a worse
 * table. Panels hang in the air and use `grabbedTo` instead.
 */
export function onLevelPlane(ray: Ray, y: number): Vec3 | null {
  const d = unit(ray.direction);
  if (Math.abs(d.y) < GRAZING) return null;
  const travel = (y - ray.origin.y) / d.y;
  // Behind you is not in front of you, however the arithmetic works out.
  if (travel <= 0) return null;
  return { x: ray.origin.x + d.x * travel, y, z: ray.origin.z + d.z * travel };
}

/**
 * Take hold of something standing on a level plane.
 *
 * Returns the offset from the ray's hit to the thing, so it keeps being held
 * where it was grabbed. Null when the ray is grazing — the caller should
 * refuse the grab rather than start one that cannot be steered.
 */
export function beginPlaneGrab(ray: Ray, at: Vec3, y: number): Vec3 | null {
  const hit = onLevelPlane(ray, y);
  return hit ? { x: at.x - hit.x, y: 0, z: at.z - hit.z } : null;
}

/** Where a thing standing on a plane goes, now that the ray points here. */
export function draggedOnPlane(ray: Ray, offset: Vec3, y: number): Vec3 | null {
  const hit = onLevelPlane(ray, y);
  return hit ? { x: hit.x + offset.x, y, z: hit.z + offset.z } : null;
}
