import * as THREE from "three";

/**
 * One easing, used by both bodies.
 *
 * The wireframe figure eased toward each snapshot and the VRM body did not —
 * it assigned position and facing straight from the wire — so the same room
 * showed one kind of person gliding and the other teleporting several times a
 * second. Nikk: "avatar movements are very choppy... we should have a lerp in
 * the movement so it's always smooth."
 *
 * WHY EASING IS HONEST HERE, given this product's rule about not showing what
 * it cannot prove. A snapshot says where somebody was at one instant, a few
 * times a second. Neither the jump nor the glide is what their body did in
 * between; the glide is merely the one that does not claim they covered the
 * distance instantaneously. The interpolation is always BEHIND the data, never
 * ahead of it — nothing here predicts, it only catches up.
 *
 * REDUCED MOTION SNAPS, and that is the whole point rather than a degradation:
 * somebody who asked for no animation gets none, and sees the samples exactly
 * as they arrive.
 */

/** Ease a point toward a target at a capped speed. Snap when asked. */
export function approachPoint(
  current: THREE.Vector3,
  to: { x: number; y: number; z: number },
  metresPerSecond: number,
  delta: number,
  snap: boolean,
): void {
  if (snap) {
    current.set(to.x, to.y, to.z);
    return;
  }
  const gap = Math.hypot(to.x - current.x, to.y - current.y, to.z - current.z);
  if (gap < 0.0005) {
    current.set(to.x, to.y, to.z);
    return;
  }
  // Speed-capped rather than a fixed fraction: a fraction crosses a long gap
  // and a short one in the same time, so somebody teleporting across the room
  // would drift over as slowly as somebody shifting their weight.
  current.lerp(TARGET.set(to.x, to.y, to.z), Math.min(1, (metresPerSecond * delta) / gap));
}

/**
 * Ease an angle toward a target THE SHORT WAY ROUND.
 *
 * Somebody turning from just under a half-turn to just over it has moved a few
 * degrees, and naive interpolation sends their whole body the long way round
 * the circle instead. Returned rather than mutated so it can be tested without
 * a scene.
 */
export function approachAngle(
  current: number,
  to: number,
  perSecond: number,
  delta: number,
  snap: boolean,
): number {
  if (snap) return to;
  let gap = to - current;
  while (gap > Math.PI) gap -= Math.PI * 2;
  while (gap < -Math.PI) gap += Math.PI * 2;
  if (Math.abs(gap) < 0.0005) return to;
  return current + gap * Math.min(1, perSecond * delta);
}

/** Ease a rotation toward a target. */
export function approachQuaternion(
  current: THREE.Quaternion,
  to: THREE.Quaternion,
  perSecond: number,
  delta: number,
  snap: boolean,
): void {
  if (snap) current.copy(to);
  else current.slerp(to, Math.min(1, perSecond * delta));
}

const TARGET = new THREE.Vector3();
