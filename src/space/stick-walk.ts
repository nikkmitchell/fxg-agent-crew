/**
 * Walking with a thumbstick, done here rather than by the library.
 *
 * WHY NOT `useXRControllerLocomotion`'s translation. Reading it while chasing
 * the teleport turned up two faults, both of which move somebody who did not
 * ask to be moved — the complaint of the whole day:
 *
 * 1. NO DEAD ZONE ON TRANSLATION. Rotation has one and translation does not:
 *    `translationChanged = xAxis != 0 || yAxis != 0`, so a stick resting at
 *    0.02 walks you slowly across the room for as long as the controller lies
 *    on the desk. Worn sticks do exactly this, and a controller nobody is
 *    holding is the normal state of a controller.
 *
 * 2. A STALE VECTOR APPLIED BY A TURN. The movement vector is a module-level
 *    helper, written only on frames where translation changed, and applied on
 *    every frame that had EITHER translation or rotation. So turning with a
 *    centred move stick re-applies whatever direction you last walked in: a
 *    two-second smooth turn slides you four metres along your last heading.
 *    Position and rotation changing together with nobody asking is precisely
 *    what Nikk described as "some kind of reset of position and rotation".
 *
 * We keep the library's ROTATION, which is correct and has its dead zone, and
 * pass `false` for translation so its helper is never written and can never be
 * applied. This is the translation half instead.
 *
 * ONE MORE THING IT FIXES. The library applies the FULL camera quaternion to
 * the push, pitch and roll included, and then ignores the y it produces. Look
 * at your feet and a forward push shortens; look at the ceiling and it
 * lengthens. Heading only here: where you are looking, flattened.
 */

/**
 * How far a stick must be pushed before it counts, as a fraction of full
 * deflection.
 *
 * 0.15 is the usual figure for consumer sticks — comfortably above the drift of
 * a worn Quest stick (a few hundredths) and far below any deliberate push.
 */
export const STICK_DEAD_ZONE = 0.15;

/**
 * The step to take this frame, in room coordinates.
 *
 * `headingYaw` is where the player is looking, in three.js terms: 0 faces −Z,
 * positive turns left. `axes` are the stick's own, WebXR's way round: y is
 * negative forward, which is why it is negated here and nowhere else.
 *
 * SPEED RISES FROM THE DEAD ZONE, not from zero: without the rescale, a push
 * just past the edge would jump straight to 15% of full speed, and the first
 * moment of movement is where a room feels either steady or twitchy.
 */
export function stickStep(
  axes: { x: number; y: number },
  headingYaw: number,
  speed: number,
  dt: number,
): { x: number; z: number } {
  const push = Math.hypot(axes.x, axes.y);
  if (!(push > STICK_DEAD_ZONE)) return { x: 0, z: 0 };
  // Rescaled onto 0..1 across the usable part of the stick's travel, and capped
  // because a stick's corners read slightly past 1.
  const strength = Math.min(1, (push - STICK_DEAD_ZONE) / (1 - STICK_DEAD_ZONE));
  const move = speed * strength * dt;
  // The push, in the player's own frame: +x is rightward, −y is forward.
  const forward = -axes.y / push;
  const rightward = axes.x / push;
  const sin = Math.sin(headingYaw);
  const cos = Math.cos(headingYaw);
  return {
    // Looking along yaw, forward is (−sin, −cos) and rightward is (cos, −sin).
    x: (forward * -sin + rightward * cos) * move,
    z: (forward * -cos + rightward * -sin) * move,
  };
}
