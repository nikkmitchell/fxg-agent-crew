/**
 * Following something smoothly, at any frame rate.
 *
 * WHY A PANEL SHOULD NOT SNAP TO THE POINTER. Setting position straight from
 * the pointer is perfectly responsive and passes on every tremor: a hand in a
 * headset is never still, and a controller ray four metres from a wall turns a
 * millimetre of wobble at the wrist into a centimetre at the panel. Nikk:
 * "panel movement and resizing should be much smoother."
 *
 * HALF-LIFE, NOT A PER-FRAME FRACTION. The usual `current += (target - current)
 * * 0.2` is wrong in a way that does not look wrong: it moves a fifth of the
 * way PER FRAME, so the same code is twice as fast at 120fps as at 60, and
 * crawls when the tab is throttled. Expressed as a half-life — the time to
 * close half the remaining gap — the motion is the same wherever it runs, which
 * matters more here than usual because the same room runs at 60 in a window and
 * 72, 90 or 120 in a headset.
 *
 * IT HAS TO STOP. Exponential decay never actually arrives, and this room
 * redraws ON DEMAND: a follow that is always a hair short would ask for another
 * frame forever, so a panel nobody is touching would keep the renderer awake
 * and the machine warm. Inside the epsilon it snaps and says it is done.
 */

/** How much of the remaining gap to close, for a step of `dt` seconds. */
export function followAlpha(dt: number, halfLife: number): number {
  if (!(dt > 0)) return 0;
  if (!(halfLife > 0)) return 1;
  return 1 - Math.pow(2, -dt / halfLife);
}

/**
 * One step toward a target.
 *
 * `settled` is what the caller uses to decide whether to ask for another frame.
 */
export function follow(
  current: number,
  target: number,
  dt: number,
  halfLife: number,
  epsilon = 0.0005,
): { value: number; settled: boolean } {
  const gap = target - current;
  if (Math.abs(gap) <= epsilon) return { value: target, settled: true };
  const next = current + gap * followAlpha(dt, halfLife);
  // A very long frame — a tab coming back from the background, a headset
  // resuming — would otherwise overshoot nothing but arrive looking teleported.
  // Arriving is right; the clamp only stops it going past.
  const value = gap > 0 ? Math.min(next, target) : Math.max(next, target);
  // SNAP ON ARRIVAL, rather than reporting "settled" while still a hair short.
  // Returning the unsnapped value left the panel resting half a millimetre from
  // where it was put, and — worse — saved that as its position, so a panel
  // crept a little further every time anybody touched it.
  if (Math.abs(target - value) <= epsilon) return { value: target, settled: true };
  return { value, settled: false };
}

/** The same, for a point on the floor. */
export function followPoint(
  current: { x: number; z: number },
  target: { x: number; z: number },
  dt: number,
  halfLife: number,
  epsilon = 0.0005,
): { value: { x: number; z: number }; settled: boolean } {
  const x = follow(current.x, target.x, dt, halfLife, epsilon);
  const z = follow(current.z, target.z, dt, halfLife, epsilon);
  return { value: { x: x.value, z: z.value }, settled: x.settled && z.settled };
}

/**
 * How long a panel takes to close half the gap to the pointer.
 *
 * Short enough that it feels attached rather than dragged through treacle, long
 * enough to swallow a hand's tremor. 60ms is about two frames of hesitation at
 * 60fps, which reads as weight rather than as lag.
 */
export const PANEL_HALF_LIFE = 0.06;
