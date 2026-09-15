/**
 * The palm joystick: moving with tracked hands, no controller and no pinch.
 *
 * Nikk, from a Quest: "the pinch to teleport is very finicky... when you put
 * either your left or your right palm up a small sphere appears above your
 * palm and that is basically your controller... there should be a shadow
 * sphere that stays in that position... if you move it forward on your left
 * hand that means you move forward... left... you strafe left... on your right
 * hand... if you move it forward or backwards nothing happens... move the
 * sphere out of the main position to the right... you rotate to the right...
 * have these values be very small but allow for moving the sphere a
 * significant amount so you can increase the speed of the joystick".
 *
 * EVERYTHING HERE IS IN THE PLAYER'S OWN FRAME — the XR origin's reference
 * space — not the room's. That is the whole trick. The joystick moves the
 * origin; if the shadow ball were pinned in the ROOM, walking forward would
 * carry the hand away from it, which reads as pushing further, which walks
 * faster: a runaway. In the player's frame the hand and the ball travel with
 * the player, and only the hand's own movement counts.
 *
 * Pure functions, so the rules are tested rather than hoped for; Immersive.tsx
 * reads the joints and applies the result.
 */

export type Vec = { x: number; y: number; z: number };
export type Quat = { x: number; y: number; z: number; w: number };

/** How long a palm must face up before the ball appears. Nikk: "for over one second". */
export const HOLD_TO_SHOW_MS = 1000;
/** A palm that turns over for less than this is a wobble, not letting go. */
export const LET_GO_GRACE_MS = 200;
/** How far up a palm must face: cos of about 50 degrees from straight up. */
export const PALM_UP_THRESHOLD = 0.65;
/** How far above the palm the ball floats. */
export const BALL_ABOVE_PALM = 0.07;
/** Hand shake this small moves nothing. */
export const DEAD_ZONE = 0.025;
/** Walking never gets faster than this, however far the ball is pushed. */
export const MAX_WALK_SPEED = 3;
/** Nor turning faster than this, in radians a second (about 140 degrees). */
export const MAX_TURN_RATE = 2.5;

/** Rotate a vector by a unit quaternion. */
export function rotate(v: Vec, q: Quat): Vec {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

/**
 * Which way the palm faces, as a direction.
 *
 * THE WEBXR HAND INPUT SPEC fixes each joint's axes: -Z runs along the bone
 * toward the fingertips and -Y points out of the palm side of the hand. So the
 * palm's normal is the joint's -Y. If a device ever turns out to disagree,
 * this is the one line to change.
 */
export function palmNormal(joint: Quat): Vec {
  return rotate({ x: 0, y: -1, z: 0 }, joint);
}

/** 1 for a palm facing straight up, -1 for straight down. */
export function palmUpness(joint: Quat): number {
  return palmNormal(joint).y;
}

/** Where the ball sits for a palm at `palm`: a little way out of the palm. */
export function ballAbove(palm: { p: Vec; q: Quat }): Vec {
  const n = palmNormal(palm.q);
  return {
    x: palm.p.x + n.x * BALL_ABOVE_PALM,
    y: palm.p.y + n.y * BALL_ABOVE_PALM,
    z: palm.p.z + n.z * BALL_ABOVE_PALM,
  };
}

export type JoystickState =
  | { phase: "idle" }
  | { phase: "raising"; since: number }
  | { phase: "active"; anchor: Vec; lastUp: number };

export const IDLE: JoystickState = { phase: "idle" };

/**
 * One frame of one hand.
 *
 * `palm` is the palm joint in the player's frame, or null when the hand is not
 * tracked. Returns the next state and, while active, where the ball is.
 */
export function stepJoystick(
  state: JoystickState,
  palm: { p: Vec; q: Quat } | null,
  nowMs: number,
): { state: JoystickState; ball: Vec | null } {
  const up = palm !== null && palmUpness(palm.q) >= PALM_UP_THRESHOLD;

  if (state.phase === "active") {
    if (up) {
      return { state: { ...state, lastUp: nowMs }, ball: ballAbove(palm!) };
    }
    // A moment of lost tracking or a wobble keeps the ball where it is and
    // stops nothing; a palm that has really turned over lets go.
    if (nowMs - state.lastUp < LET_GO_GRACE_MS) return { state, ball: palm ? ballAbove(palm) : null };
    return { state: IDLE, ball: null };
  }

  if (!up) return { state: IDLE, ball: null };
  if (state.phase === "idle") return { state: { phase: "raising", since: nowMs }, ball: null };
  if (nowMs - state.since < HOLD_TO_SHOW_MS) return { state, ball: null };
  // THE SHADOW BALL is wherever the ball first appears, and stays there.
  const ball = ballAbove(palm!);
  return { state: { phase: "active", anchor: ball, lastUp: nowMs }, ball };
}

/** How far past the dead zone a push is, in metres; 0 inside it. */
const beyondDeadZone = (distance: number) => Math.max(0, distance - DEAD_ZONE);

/**
 * Speed for a push, in metres a second.
 *
 * GENTLE NEAR THE CENTRE, FAST FAR OUT, as asked: a few centimetres is a slow
 * walk, a long reach is a run. Linear plus a square term: 5 cm past the dead
 * zone is about 0.3 m/s, 10 cm about 0.7, 20 cm about 1.8, capped at 3.
 */
export function walkSpeedFor(distance: number): number {
  const e = beyondDeadZone(distance);
  return Math.min(MAX_WALK_SPEED, 5 * e + 20 * e * e);
}

/** Turn rate for a sideways push, in radians a second, on the same curve's shape. */
export function turnRateFor(distance: number): number {
  const e = beyondDeadZone(distance);
  return Math.min(MAX_TURN_RATE, 4 * e + 25 * e * e);
}

/**
 * LEFT HAND: the velocity to walk at, in the player's frame.
 *
 * The direction is simply the way the ball has been pushed, flattened onto
 * the floor. Forward away from you walks forward; left steps left. No head
 * direction is needed, because the push is already in the direction you mean.
 * Up and down do nothing: "you don't look up and down".
 */
export function walkVelocity(anchor: Vec, ball: Vec): { x: number; z: number } {
  const dx = ball.x - anchor.x;
  const dz = ball.z - anchor.z;
  const distance = Math.hypot(dx, dz);
  const speed = walkSpeedFor(distance);
  if (speed === 0) return { x: 0, z: 0 };
  return { x: (dx / distance) * speed, z: (dz / distance) * speed };
}

/**
 * RIGHT HAND: how fast to turn, in radians a second. Positive turns LEFT,
 * which is three.js's direction for a positive yaw.
 *
 * Only the sideways part of the push counts, sideways relative to where the
 * head faces. Forward and back do nothing.
 *
 * `headYaw` is the head's heading in the same frame as the points, in three.js
 * terms: 0 looks down -Z, and positive turns left.
 */
export function turnRate(anchor: Vec, ball: Vec, headYaw: number): number {
  const dx = ball.x - anchor.x;
  const dz = ball.z - anchor.z;
  // The head's right-hand direction for this yaw: (cos, 0, -sin).
  const rightward = dx * Math.cos(headYaw) - dz * Math.sin(headYaw);
  const rate = turnRateFor(Math.abs(rightward));
  // Pushed right turns right, which is a NEGATIVE yaw.
  return rightward > 0 ? -rate : rate;
}

/**
 * Turn the player about their own head rather than about the origin.
 *
 * The origin is wherever the session started, which can be a step or two
 * away from where the person now stands in their play space. Turning about it
 * would swing them round in an arc — sickening. Turning about the head keeps
 * them on the spot, which is what turning means.
 *
 * `origin` and `head` are in room coordinates; returns the origin's new place
 * and yaw.
 */
export function turnAbout(
  origin: { x: number; z: number; yaw: number },
  head: { x: number; z: number },
  angle: number,
): { x: number; z: number; yaw: number } {
  const ox = origin.x - head.x;
  const oz = origin.z - head.z;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // A positive yaw about +Y takes (x, z) to (x cos + z sin, -x sin + z cos).
  return {
    x: head.x + ox * c + oz * s,
    z: head.z - ox * s + oz * c,
    yaw: origin.yaw + angle,
  };
}

/**
 * How far locomotion may move the player in ONE frame.
 *
 * Nikk, twice in one session: "I just automatically teleport on my own without
 * me doing anything", and "I was right in front of you and now I've been
 * teleported off to the side". Walking and turning are both worked out from
 * measured poses, and a headset that briefly mislocates a hand or a head
 * reports a pose metres from the real one. Turning in place is the dangerous
 * one: it swings the player's frame about the head, so a head reported in the
 * wrong place turns them about the wrong pivot and throws them across the room.
 *
 * A step at the fastest walk is 0.3 m per tenth of a second, and a real turn
 * about a real head moves the origin by a fraction of that. So a frame that
 * would move somebody further than this did not come from anything they did,
 * and refusing it costs a person nothing they can feel.
 */
export const MAX_STEP_PER_FRAME = 0.5;

/** Whether a frame's movement is small enough to have come from a person. */
export function believableStep(
  from: { x: number; z: number },
  to: { x: number; z: number },
  limit = MAX_STEP_PER_FRAME,
): boolean {
  return Math.hypot(to.x - from.x, to.z - from.z) <= limit;
}
