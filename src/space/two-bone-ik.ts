/**
 * Where to put an elbow so the hand lands where the hand actually is.
 *
 * A headset measures a head and two hands and nothing else. The old figure
 * solved that by drawing nothing else — no arms, no legs, just the parts that
 * were reported. A full body cannot do that: it HAS an elbow, and something has
 * to decide where it goes.
 *
 * This is that something, and it is deliberately the only invention in the
 * avatar. Given a shoulder, a measured hand, and the two arm lengths, there is
 * a circle of possible elbow positions; the pole picks one point on it. That is
 * a guess, but it is a guess about a joint whose ENDS are both known, which is
 * a much smaller claim than guessing a pose outright.
 *
 * Pure, so it can be tested without a renderer — and it needs testing, because
 * the failure mode is an arm bending the wrong way, which is the exact thing
 * the original comment said a full body would get wrong.
 */

export type Vec = { x: number; y: number; z: number };

const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const scale = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k, z: a.z * k });
const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const length = (a: Vec): number => Math.hypot(a.x, a.y, a.z);

const normalise = (a: Vec): Vec => {
  const l = length(a);
  return l < 1e-9 ? { x: 0, y: 0, z: 0 } : scale(a, 1 / l);
};

/**
 * The elbow, given where the arm starts and ends.
 *
 * `pole` is the direction the elbow is pushed toward — down and slightly out
 * for a human arm. It is projected onto the plane perpendicular to the arm, so
 * a pole pointing straight along the arm (which would be ambiguous) still
 * produces a stable answer rather than a NaN.
 */
export function elbowFor(
  shoulder: Vec,
  hand: Vec,
  upperLength: number,
  lowerLength: number,
  pole: Vec,
): Vec {
  const toHand = sub(hand, shoulder);
  const reach = length(toHand);
  const span = upperLength + lowerLength;

  // OUT OF REACH: the arm is straight and the hand is simply further away than
  // the arm is long. Straightening it is right — the alternative is an elbow
  // that snaps to some other place, and an arm that cannot reach should look
  // like an arm that cannot reach.
  if (reach >= span || reach < 1e-6) {
    const direction = reach < 1e-6 ? { x: 0, y: -1, z: 0 } : normalise(toHand);
    return add(shoulder, scale(direction, upperLength));
  }

  // Standard two-bone solution: the elbow lies on a circle. `along` is how far
  // down the shoulder-to-hand line its centre sits; `radius` is the circle.
  const along = (reach * reach + upperLength * upperLength - lowerLength * lowerLength) / (2 * reach);
  const radiusSquared = upperLength * upperLength - along * along;
  const radius = radiusSquared > 0 ? Math.sqrt(radiusSquared) : 0;

  const axis = normalise(toHand);
  // The pole, with any component along the arm removed, is the direction on
  // that circle to pick. A pole parallel to the arm leaves nothing, so fall
  // back to straight down, which is where a resting elbow is.
  let bend = sub(pole, scale(axis, dot(pole, axis)));
  if (length(bend) < 1e-6) {
    const down = { x: 0, y: -1, z: 0 };
    bend = sub(down, scale(axis, dot(down, axis)));
    if (length(bend) < 1e-6) bend = { x: 1, y: 0, z: 0 };
  }

  return add(add(shoulder, scale(axis, along)), scale(normalise(bend), radius));
}
