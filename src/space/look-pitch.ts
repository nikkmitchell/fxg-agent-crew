/**
 * Looking up and down in the window, which you could not do before.
 *
 * Nikk: "add a pitch control for the fps controller there, so we can look
 * down". The flat view turned but never tilted — `camera.rotation.set(0, yaw,
 * 0)` with the first component hard-coded to zero — so anything on the floor,
 * which includes every figure's feet and the whole question of whether a body
 * is standing ON the ground or hovering above it, was unlookable-at. That is a
 * poor state for the view whose entire job is checking the room.
 *
 * WHY THIS IS A FUNCTION AND NOT TWO LINES IN THE DRAG HANDLER. The clamp is
 * the part that has to be right, and it is not obvious. The camera uses "YXZ"
 * order, so pitch is applied about X after yaw about Y; at exactly ±90° the
 * remaining axes coincide and the orientation gimbal-locks, and past 90° the
 * view turns upside down and the horizon rolls. Neither is a thing anybody
 * would report as "the pitch clamp is missing" — they would report that the
 * room went strange when they looked down, which is much harder to trace.
 */

/**
 * As far as you may tilt: a hair under straight up or straight down.
 *
 * Not less. The whole request was to look DOWN, and stopping at a polite 60°
 * would leave the floor at your feet still out of shot. The small gap keeps it
 * off the singularity without being noticeable.
 */
export const MAX_PITCH = Math.PI / 2 - 0.01;

/** Radians per pixel of pointer movement. Matches the yaw sensitivity. */
export const LOOK_SENSITIVITY = 0.004;

/**
 * A new pitch after dragging `movementY` pixels, clamped so the view cannot
 * flip. Dragging DOWN looks down, which is the direct mapping — the same one
 * the horizontal drag already uses, and the opposite of the "inverted" flight
 * convention nobody asked for here.
 */
export function tiltBy(pitch: number, movementY: number, sensitivity = LOOK_SENSITIVITY): number {
  return clampPitch(pitch - movementY * sensitivity);
}

/** Keep a pitch inside the range where the camera stays upright. */
export function clampPitch(pitch: number): number {
  if (!Number.isFinite(pitch)) return 0;
  return Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
}
