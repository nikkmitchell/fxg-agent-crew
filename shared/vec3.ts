/**
 * Plain 3D vector arithmetic on { x, y, z }, for the pure modules that must not
 * load three.js (the server and the tests use them too). The arm solver, the
 * finger angles, the grab ray and the hand gestures each had their own copies
 * of these lines (2026-10-22).
 *
 * Normalising is deliberately NOT here: each caller decides what a zero vector
 * means for it (no direction at all, straight ahead, or left as zero), and
 * that choice is part of its own rule.
 */
export type Vec3 = { x: number; y: number; z: number };

export const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const scale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k });
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
