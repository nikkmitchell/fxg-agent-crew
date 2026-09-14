import type { Vec3 } from "./space-layout.js";

/**
 * Somewhere to stand that nobody is already standing in.
 *
 * THE BUG THIS EXISTS TO FIX. `destinationFor` returns ONE point per panel —
 * `standFor(place)` — and returns the same one to everybody, so every actor the
 * audit trail sent to the task board was sent to identical coordinates. Nikk,
 * from a headset: "now both agents are standing in the same place looking at
 * the board, we don't want that". Desks already avoid this by hashing the actor
 * id; panels never got the same treatment.
 *
 * WHY IT IS NOT A HASH. A hash of the name would spread agents deterministically
 * and could not honour the other half of the request — not standing where a
 * HUMAN is — because a hash cannot know who is already there. This takes the
 * live positions instead.
 *
 * THE ONE WHO ARRIVES IS THE ONE WHO MOVES. Whoever is already standing there
 * keeps their place, always. A connected person's position is reported by their
 * own headset, and nudging them aside to make room would be the server
 * overwriting a fact a device told us — the rule the whole room is built on. So
 * the newcomer goes around, even when the newcomer got there first by some
 * other measure.
 */

/**
 * How close is too close, in metres.
 *
 * Shoulders are about 0.45 m across, so 0.8 leaves a clear gap between two
 * people rather than merely stopping them intersecting. Two figures 0.5 m apart
 * do not overlap and still read as one person standing oddly.
 */
export const PERSONAL_SPACE = 0.8;

/** How far out the first ring of alternatives sits. Just over one person-width,
 * so a displaced arrival is beside the target rather than behind it. */
const RING_STEP = 0.9;

/** How many places are tried on each ring before widening. Eight is every
 * 45 degrees, which is finer than anybody can tell two standing figures apart. */
const PER_RING = 8;

/** How far out to keep looking before giving up and stacking. Three rings is
 * 2.7 m, wider than any panel's frontage; past that the room is genuinely full
 * and standing close is more honest than standing in the next county. */
const RINGS = 3;

const flatDistance = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

/** Whether anybody is already within `PERSONAL_SPACE` of a spot. */
export function isFree(spot: { x: number; z: number }, taken: readonly { x: number; z: number }[]): boolean {
  return taken.every((other) => flatDistance(spot, other) >= PERSONAL_SPACE);
}

/**
 * A free spot at or near `target`.
 *
 * `taken` is everybody else's position — the caller leaves the mover out of it,
 * because a figure is always within nought metres of itself.
 *
 * `seed` varies the ORDER the alternatives are tried in, so two displaced
 * actors do not always reach for the same one first. It is the actor's own id:
 * stable across ticks, so an agent asked twice for the same destination does not
 * shuffle sideways between one audit row and the next.
 *
 * IT IS NOT WHAT MAKES THIS CORRECT, and it cannot be. There are eight slots
 * per ring and more than eight possible names, so by pigeonhole two actors will
 * sometimes prefer the same one — "Sill" and "Plumbline" already do. What keeps
 * figures apart is `taken` containing every other occupant's CLAIM, so the
 * second one placed sees the first and moves on. The seed only stops them
 * queueing up in the same order every time.
 *
 * `clamp` is the caller's own room clamp, PASSED IN rather than imported.
 * `Presence` keeps its clamp as a local and this module is in `shared`, so
 * importing one would be reaching across a boundary for it. It matters that the
 * clamp is applied here rather than to the result: the comment on `ROOM` records
 * that a clamp once "pulled every idle figure onto the same point on the
 * boundary and they stood inside one another", which is this exact bug arriving
 * by a different road. So each candidate is clamped and THEN checked.
 *
 * Returns the target itself when it is free, so nothing moves without cause.
 */
export function standingRoomNear(
  target: Vec3,
  taken: readonly { x: number; z: number }[],
  seed = "",
  clamp: (at: Vec3) => Vec3 = (at) => at,
): Vec3 {
  if (isFree(target, taken)) return target;

  // FNV-1a, the same hash `deskFor` uses, so one identity gets one stable
  // preference rather than two systems disagreeing about where it likes to be.
  const hash = [...seed].reduce(
    (accumulated, character) => Math.imul(accumulated ^ character.charCodeAt(0), 16_777_619) >>> 0,
    2_166_136_261,
  );
  const offset = hash % PER_RING;

  for (let ring = 1; ring <= RINGS; ring += 1) {
    for (let step = 0; step < PER_RING; step += 1) {
      // Rotated by the seed so different actors sweep the ring in different
      // orders, and alternating direction so two actors with adjacent hashes
      // do not follow each other round it.
      const slot = (offset + step * (ring % 2 === 1 ? 1 : PER_RING - 1)) % PER_RING;
      const angle = (slot / PER_RING) * Math.PI * 2;
      const candidate = clamp({
        x: target.x + Math.cos(angle) * RING_STEP * ring,
        y: target.y,
        z: target.z + Math.sin(angle) * RING_STEP * ring,
      });
      // The clamp can pull a candidate back onto somebody against a wall, so
      // the check happens AFTER clamping rather than before it.
      if (isFree(candidate, taken)) return candidate;
    }
  }

  // Genuinely nowhere free. The target is returned rather than a spot chosen
  // for being empty-looking: standing too close is a visible problem somebody
  // can report, and being quietly teleported across the room is not.
  return target;
}
