/**
 * Where the closed controls sit, and which way their face points.
 *
 * SPLIT OUT OF RoomControls SO THE ARITHMETIC IS ARGUABLE. The placement used
 * to be three constants and a `rotation.set(0, yaw, 0)` buried in a frame loop,
 * which makes "why is it at that height and that angle" unanswerable without
 * reading the renderer. The numbers below are the whole of the decision.
 *
 * WHAT A TEST HERE CAN AND CANNOT TELL YOU. It can prove the panel is lower
 * than it was, that its face pitches upward rather than down, and that it stays
 * a fixed distance in front whichever way you turn. It cannot tell you the
 * panel is out of your way, or that the labels are legible at that angle.
 * Those need somebody in a headset — the same gap that let a settings column
 * run from a wearer's chin to below the floor with every test passing.
 */

/** How far in front of the wearer the closed pair floats. Unchanged. */
export const CLOSED_AHEAD = 0.62;

/**
 * How far off the floor, absolute rather than relative to the head, so it stays
 * put whether you are standing or leaning forward.
 *
 * LOWERED FROM 1.02. Nikk, from inside a headset: "the settings button is too
 * high up, can you make it lower so it doesn't block anyones view". At 1.02 it
 * sat at waist height and straight up, which put it through the middle of the
 * view of anything standing a couple of metres away — including a person you
 * are talking to. 0.86 is upper-thigh: still an easy reach downward, and below
 * the band a conversation happens in.
 */
export const CLOSED_HEIGHT = 0.86;

/** Where the eyes are, for working out the angle down to the panel. A standing
 * adult in this room measures 1.55-1.65; the middle of that is close enough for
 * an angle, and nothing here is reported by a device. */
const EYE_HEIGHT = 1.6;

/**
 * The pitch that would point the panel's face straight at the eyes.
 *
 * Pure geometry: the panel is `CLOSED_AHEAD` in front and `EYE_HEIGHT -
 * CLOSED_HEIGHT` below, so the sight line is that far off vertical. Exported
 * because it is the number `CLOSED_TILT` is a fraction OF, and a fraction whose
 * denominator is invisible is just another magic constant.
 */
export function squareOnTilt(
  ahead = CLOSED_AHEAD,
  height = CLOSED_HEIGHT,
  eye = EYE_HEIGHT,
): number {
  return Math.atan2(eye - height, ahead);
}

/**
 * How much of that to actually apply.
 *
 * NOT ALL OF IT, and this is the part to argue with. Pointing the face straight
 * at the eyes lays the panel nearly flat — a tray at thigh height, which reads
 * as a thing to put something on rather than a thing to press, and which loses
 * its own silhouette from any other angle. Nikk asked for "facing up a bit
 * more", which is a nudge and not a right angle. Half is the nudge.
 *
 * At the numbers above that is about 25 degrees of pitch out of a possible 50.
 */
export const TILT_FRACTION = 0.5;

/** The pitch applied to the closed pair, in radians. Positive means the face
 * points upward; see `closedControlPose` for the sign that reaches Three.js. */
export function closedTilt(): number {
  return squareOnTilt() * TILT_FRACTION;
}

export type ControlPose = {
  /** Absolute position in the room. */
  position: readonly [number, number, number];
  /**
   * Euler angles for rotation order YXZ — yaw first, then pitch about the
   * panel's OWN sideways axis.
   *
   * THE ORDER MATTERS AND THE DEFAULT IS WRONG HERE. Three.js defaults to XYZ,
   * which pitches about the world X axis before yawing; a panel behind you
   * would then tilt the wrong way entirely. YXZ turns it to face you and then
   * tips that face up, which is what "facing up a bit more" means at any yaw.
   *
   * The pitch is NEGATIVE: rotating the face normal (+Z) about X by a positive
   * angle sends it to (0, -sin, cos), which points at the floor. Up is the
   * other way round, and getting this backwards is a one-character bug that
   * looks like the panel hiding its face from you.
   */
  rotation: readonly [number, number, number];
};

/**
 * The closed pair's pose, given where the wearer's body is and which way the
 * panel has eased round to.
 *
 * `yaw` is the panel's own eased heading rather than the body's, because the
 * panel deliberately lags a turn — a panel welded to your gaze can never be
 * looked away from.
 */
export function closedControlPose(at: { x: number; z: number }, yaw: number): ControlPose {
  return {
    position: [
      at.x - Math.sin(yaw) * CLOSED_AHEAD,
      CLOSED_HEIGHT,
      at.z - Math.cos(yaw) * CLOSED_AHEAD,
    ],
    rotation: [-closedTilt(), yaw, 0],
  };
}
