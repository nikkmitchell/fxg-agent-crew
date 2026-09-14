import type { Pose } from "../../shared/space-wire";

/**
 * A hand that has stopped being tracked.
 *
 * Headset hand tracking drops out constantly and briefly — a hand leaves the
 * cameras' view, passes behind the other one, or the light changes — and it
 * comes back a moment later in roughly the same place. The first version sent
 * whatever the input source's three.js object said, and an object whose pose
 * was never located sits at the origin of the player's space: on the floor,
 * between their feet. Every dropout threw both of Nikk's hands to the ground.
 *
 * So a lost hand is HELD where it last was, for a while. That is a claim about
 * the recent past rather than the present, which is why it expires: after
 * `HOLD_MS` of silence we genuinely do not know where the hand is, and the
 * figure loses it rather than leaving a hand hanging in the room for the rest
 * of the session. A controller put down on a desk disappears; a hand waved out
 * of view and back stays put.
 */
export type Held = {
  /** The last pose we actually measured, or null if we have none worth keeping. */
  pose: Pose | null;
  /** When that measurement was taken, in the same clock the caller passes in. */
  at: number;
  /** Where the hand was relative to the head when last measured, if the head was known. */
  offset?: { x: number; y: number; z: number } | null;
};

/**
 * Ten seconds. Long enough to cover every dropout seen in testing — hands
 * behind the back, a reach outside the tracking volume — and short enough that
 * a hand left hanging is obviously a stale hand rather than a fixture.
 */
export const HOLD_MS = 10_000;

export const NO_HAND: Held = { pose: null, at: 0 };

/**
 * A held hand MOVES WITH THE PERSON.
 *
 * Seen on the wire (board card saha-ing-fcaa774d): Nikk's right hand read 3.3 m
 * from his own head, frozen at one room coordinate while his head and left hand
 * kept moving, then vanished. That is a hand held in the ROOM while its owner
 * walked or teleported away from it. So a hand is held where it was relative
 * to the head: turn round or walk off mid-dropout and the hand comes too. And a
 * hand whose owner has moved more than a couple of metres since is given up at
 * once — nobody's arm is that long, and a held hand is a guess, not a fact.
 */
export const GIVE_UP_REACH = 1.2;

/** What to report for one hand this frame, given what the headset just said. */
export function heldHand(
  previous: Held,
  live: Pose | null,
  now: number,
  holdMs: number = HOLD_MS,
  /** The head this frame, when known, so a held hand keeps its place relative to it. */
  head: Pose | null = null,
): Held {
  if (live !== null) {
    return {
      pose: live,
      at: now,
      offset: head ? { x: live.p.x - head.p.x, y: live.p.y - head.p.y, z: live.p.z - head.p.z } : null,
    };
  }
  if (previous.pose === null || now - previous.at >= holdMs) return NO_HAND;
  if (!head || !previous.offset) return previous;
  const offset = previous.offset;
  if (Math.hypot(offset.x, offset.y, offset.z) > GIVE_UP_REACH) return NO_HAND;
  return {
    ...previous,
    pose: { p: { x: head.p.x + offset.x, y: head.p.y + offset.y, z: head.p.z + offset.z }, q: previous.pose.q },
  };
}
