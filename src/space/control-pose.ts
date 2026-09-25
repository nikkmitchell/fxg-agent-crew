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

/**
 * How far in front of the wearer the closed pair floats.
 *
 * BROUGHT IN FROM 0.62. Nikk asked for it "closer to the user" after the first
 * pass. 0.50 is still outside a comfortable reach — a controller ray does not
 * need contact — and it keeps the pair away from the near clip plane, which is
 * where a panel starts to clip through itself as you lean.
 */
export const CLOSED_AHEAD = 0.5;

/**
 * How far off the floor, absolute rather than relative to the head, so it stays
 * put whether you are standing or leaning forward.
 *
 * LOWERED TWICE. It was 1.02 — waist height and straight up, which put it
 * through the middle of the view of anything standing a couple of metres away,
 * including a person you were talking to. Nikk: "too high up, can you make it
 * lower so it doesn't block anyones view". 0.86 was the first answer and was
 * still too high from inside a headset: "it should be more lower". 0.72 is
 * mid-thigh.
 *
 * THE FLOOR ON THIS IS NOT COMFORT, IT IS REACH. Much below about 0.6 and a
 * seated wearer is reaching into their own lap, and the pair starts competing
 * with the floor for the same pixels. If it is still too high, say so again
 * and this is the number — but expect the next stop to be the last.
 */
export const CLOSED_HEIGHT = 0.72;

/**
 * HOW FAR BELOW THE HEAD, which is what decides the height now.
 *
 * Nikk (4739): "make it fix y position be relative to your head so have a meter
 * below your head and a half a meter in front ... have it lerped to where your
 * head position is so it can be smoother". An absolute height meant a seated
 * wearer reached into their lap and a tall one stooped; a metre below the eyes
 * is the same reach for everybody. The follow is eased in RoomControls, so
 * leaning does not drag it, which is what the absolute height was guarding.
 */
export const CLOSED_BELOW_HEAD = 1.0;

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
  height = EYE_HEIGHT - CLOSED_BELOW_HEAD,
  eye = EYE_HEIGHT,
): number {
  return Math.atan2(eye - height, ahead);
}

/**
 * How much of that to actually apply.
 *
 * NOT ALL OF IT, but more than it was. Pointing the face straight at the eyes
 * lays the panel nearly flat — a tray at thigh height reads as somewhere to put
 * something rather than something to press, and it loses its own silhouette
 * from every other angle. So this stays a fraction.
 *
 * RAISED FROM HALF TO 0.7, because half was not enough from inside a headset:
 * Nikk asked twice, "facing up a bit more" and then "pointed upwards a little
 * more". Lowering the pair also steepens the angle down to it, so the same
 * fraction would have tilted it further anyway — 0.7 of a steeper angle is a
 * markedly flatter panel than 0.5 of the old one, and the numbers below say by
 * how much.
 */
export const TILT_FRACTION = 0.7;

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
export function closedControlPose(at: { x: number; y?: number; z: number }, yaw: number): ControlPose {
  return {
    position: [
      at.x - Math.sin(yaw) * CLOSED_AHEAD,
      // Relative to the HEAD when the headset says where it is (Nikk, 4739):
      // "a meter below your head and a half a meter in front". Without a head
      // height (tests, a desktop), the old absolute height stands.
      at.y === undefined ? CLOSED_HEIGHT : at.y - CLOSED_BELOW_HEAD,
      at.z - Math.cos(yaw) * CLOSED_AHEAD,
    ],
    rotation: [-closedTilt(), yaw, 0],
  };
}
