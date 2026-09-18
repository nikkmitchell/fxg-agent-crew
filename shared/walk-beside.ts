import type { Vec3 } from "./space-layout.js";

/**
 * Where to stand to walk BESIDE somebody, rather than where they just were.
 *
 * WHY THIS IS NOT A RECOMPUTED HOME. Waffle asked for it from inside the room
 * and Nikk from the street: "a follow user ability, so i can walk down the
 * street in AR with my agent walking beside me". The presence API could express
 * one destination, so following meant a timer re-sending a home every couple of
 * seconds — and Waffle measured a person moving several metres between samples,
 * which turns walking together into a chase that is always behind.
 *
 * Two things fix that, and both are here rather than in the server so they can
 * be argued with in a test:
 *
 *   1. AIM BESIDE, NOT AT. A spot offset to one side of the target and slightly
 *      back, so the follower is a companion and is not standing in the view.
 *   2. LEAD A MOVING TARGET. Aim at where they will be in `lead` seconds, so
 *      arrival is alongside instead of trailing by however long the last leg
 *      took.
 *
 * THE FACING CONVENTION IS THE DANGEROUS PART. `facing f` means a forward vector
 * of (-sin f, 0, -cos f) — stated in shared/agent-home.ts and not the atan2 used
 * for panels. Everything below derives from that one fact, so if it is ever
 * wrong, it is wrong here and the tests say what was meant.
 *
 * WHAT I COULD NOT CHECK: whether "left" looks like the person's left to
 * somebody standing in the room. The vectors follow the documented forward and
 * three.js's right-handed Y-up frame, which makes left = (Fz, 0, -Fx). Nobody
 * has looked at it in a headset yet, and a mirrored renderer would swap the two
 * without any test failing.
 */

export const WALK_BESIDE = {
  /** Sideways gap. Close enough to be together, wide enough not to collide. */
  gap: 0.85,
  /** A little behind the shoulder, so the follower is not in front of a person's eyes. */
  behind: 0.25,
  /** How far ahead to aim when the target is moving, in seconds of their travel. */
  lead: 0.6,
  /**
   * Above this apparent speed a sample is a JUMP, not movement, and leading it
   * is worse than not: a teleport across the room reads as 30 m/s and would
   * throw the follower far past the target. 4 m/s is a brisk run, so anything
   * faster is not somebody walking down a street.
   */
  jumpSpeed: 4,
  /** Below this, they are standing still and there is nothing to lead. */
  stillSpeed: 0.05,
} as const;

export type Tuning = typeof WALK_BESIDE;

export type Sample = { at: Vec3; atMs: number };

/** The forward unit vector for a `facing` angle. */
export const forwardOf = (facing: number): Vec3 => ({
  x: -Math.sin(facing),
  y: 0,
  z: -Math.cos(facing),
});

/**
 * The unit vector to somebody's left, given where they face.
 *
 * left = up × forward in a right-handed Y-up frame, which for the documented
 * forward reduces to (Fz, 0, -Fx).
 */
export const leftOf = (facing: number): Vec3 => {
  const forward = forwardOf(facing);
  return { x: forward.z, y: 0, z: -forward.x };
};

/**
 * How fast the target appears to be moving, or `null` when we should not use it.
 *
 * Null has two causes and they are deliberately not distinguished by the
 * caller: no previous sample to compare against, and a sample so fast it must
 * be a jump. In both cases the honest answer is "do not lead", not a guess.
 */
export function apparentVelocity(
  previous: Sample | null,
  current: Sample,
  tuning: Tuning = WALK_BESIDE,
): Vec3 | null {
  if (!previous) return null;
  const seconds = (current.atMs - previous.atMs) / 1000;
  // A zero or backwards interval gives no information, and dividing by it
  // produces an Infinity that would be carried into a position.
  if (!(seconds > 0)) return null;

  const velocity = {
    x: (current.at.x - previous.at.x) / seconds,
    y: 0,
    z: (current.at.z - previous.at.z) / seconds,
  };
  const speed = Math.hypot(velocity.x, velocity.z);
  if (speed > tuning.jumpSpeed) return null;
  if (speed < tuning.stillSpeed) return { x: 0, y: 0, z: 0 };
  return velocity;
}

/**
 * The spot to aim for to end up beside `target`.
 *
 * `velocity` null means "not moving, or we do not trust the sample" — see
 * `apparentVelocity`. In that case this is simply the spot beside them, which is
 * also what makes a follower settle rather than circle when somebody stops.
 */
export function besideSpot(
  target: { at: Vec3; facing: number },
  side: "left" | "right",
  velocity: Vec3 | null = null,
  tuning: Tuning = WALK_BESIDE,
): Vec3 {
  const forward = forwardOf(target.facing);
  const left = leftOf(target.facing);
  const sideways = side === "left" ? 1 : -1;

  const lead = velocity ? tuning.lead : 0;
  return {
    x: target.at.x + left.x * tuning.gap * sideways - forward.x * tuning.behind + (velocity?.x ?? 0) * lead,
    y: 0,
    z: target.at.z + left.z * tuning.gap * sideways - forward.z * tuning.behind + (velocity?.z ?? 0) * lead,
  };
}

/**
 * Which side to walk on, when nobody has said.
 *
 * Stable per pair rather than random, so a follower does not swap shoulders
 * every tick, and different followers of the same person tend to different
 * sides instead of both claiming one.
 */
export function defaultSide(followerId: string, targetId: string): "left" | "right" {
  const pair = `${followerId.toLowerCase()}->${targetId.toLowerCase()}`;
  let hash = 2_166_136_261;
  for (const character of pair) hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  return hash % 2 === 0 ? "left" : "right";
}
