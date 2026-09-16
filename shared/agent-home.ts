/**
 * Where an agent lives in the room, and the two ways people ask to put it.
 *
 * Nikk: "agents should choose a position where they stay and they should
 * remember that — we can save that on server — and allow users to be able to
 * tell them like 'I want you to be standing over here facing me' or 'I want
 * you to be standing beside me facing away from me so I can watch your work'...
 * and then they should set that to their home space".
 *
 * Shared because the headset works out the spot from where the person stands
 * and the server clamps and stores it; both must mean the same thing by
 * "facing".
 *
 * FACING, as everywhere in the room: an avatar facing `f` looks along
 * (-sin f, 0, -cos f), and `facingToward(from, to)` is atan2(from - to).
 */

export type AgentHome = { at: { x: number; y: number; z: number }; facing: number };

export type HomeSummary = AgentHome & { actorId: string; setBy: string; setAt: string };

export type Spot = { x: number; z: number };

/**
 * Which way to look in order to see somebody. THE ONE COPY OF THIS FORMULA.
 *
 * It reads backwards — `from` minus `to` — and that is exactly why it lives in
 * one place. An avatar looks down its local -Z at yaw zero, so its forward is
 * (-sin f, 0, -cos f); the two negations cancel and the subtraction inverts.
 * Doing it the intuitive way round, `to` minus `from`, is not a small error but
 * precisely 180 degrees: the avatar walks up to the person and presents its back.
 *
 * That is not hypothetical. Waffle, working from outside with no view of the
 * room, derived it the intuitive way and stood behind people for an hour until
 * clem put on a headset and said so. An agent cannot SEE that it is facing
 * backwards, and no amount of care fixes a sign you have no way to check — so
 * `resolveFacing` below exists to make sure nobody has to get this subtraction
 * right merely to look somebody in the eye.
 */
export const facingToward = (from: Spot, to: Spot): number =>
  Math.atan2(from.x - to.x, from.z - to.z);

/** Closer than this and there is no direction from one to the other. */
const SAME_SPOT = 0.001;

export type FacingAsked = { facing: number } | { error: string };

/**
 * What "facing" a caller asked for: an angle they worked out, or a NAME.
 *
 * `standing` is where the agent will BE — the home being set, not where it
 * happens to be now. Resolving against its current position would aim it
 * correctly from the wrong place and leave it wrong on arrival.
 */
export function resolveFacing(
  asked: { facing?: unknown; face?: unknown },
  standing: Spot,
  whereIs: (actorId: string) => Spot | null,
  whoIsHere: () => string[],
): FacingAsked {
  const named = typeof asked.face === "string" ? asked.face.trim() : "";
  const angle = asked.facing;
  const gaveAngle = angle !== undefined && angle !== null;

  // Refused rather than ranked. Someone sending both has two ideas about where
  // to look, and silently honouring one of them teaches them the wrong lesson.
  if (named && gaveAngle) {
    return { error: "give either facing (an angle) or face (somebody's name), not both" };
  }

  if (named) {
    const place = whereIs(named);
    if (!place) {
      const here = whoIsHere();
      return {
        error: here.length
          ? `nobody called ${named} is in the room. These are: ${here.join(", ")}`
          : `nobody called ${named} is in the room, which is empty`,
      };
    }
    // atan2(0, 0) is 0, a confident answer meaning nothing. Say so instead.
    if (Math.hypot(standing.x - place.x, standing.z - place.z) < SAME_SPOT) {
      return { error: `that spot is where ${named} is standing, so there is no way to face them from it` };
    }
    return { facing: facingToward(standing, place) };
  }

  if (typeof angle === "number" && Number.isFinite(angle)) return { facing: angle };
  return { error: "provide facing (an angle in radians) or face (the name of somebody to look at)" };
}

/** How far in front of you "here, facing me" puts an agent: conversational, not in your face. */
export const IN_FRONT_DISTANCE = 1.3;
/** How far to your side "beside me" puts an agent. */
export const BESIDE_DISTANCE = 0.9;
/** And a little ahead, so its screen is in front of both of you, not behind your shoulder. */
export const BESIDE_AHEAD = 0.35;

type Person = { at: { x: number; z: number }; facing: number };

/** "Stand over here, facing me": in front of the person, turned to face them. */
export function homeFacingMe(person: Person): AgentHome {
  const at = {
    x: person.at.x - Math.sin(person.facing) * IN_FRONT_DISTANCE,
    y: 0,
    z: person.at.z - Math.cos(person.facing) * IN_FRONT_DISTANCE,
  };
  return { at, facing: Math.atan2(at.x - person.at.x, at.z - person.at.z) };
}

/**
 * "Beside me, facing away from me so I can watch your work": at the person's
 * side, facing the way they face. An agent's screen sits in front of the agent,
 * so it then sits in front of the person too, the way a colleague's monitor
 * does when you pull up a chair.
 */
export function homeBesideMe(person: Person, side: "left" | "right" = "right"): AgentHome {
  // The person's right is (cos f, 0, -sin f) for a facing f.
  const sign = side === "right" ? 1 : -1;
  const at = {
    x: person.at.x + sign * Math.cos(person.facing) * BESIDE_DISTANCE - Math.sin(person.facing) * BESIDE_AHEAD,
    y: 0,
    z: person.at.z - sign * Math.sin(person.facing) * BESIDE_DISTANCE - Math.cos(person.facing) * BESIDE_AHEAD,
  };
  return { at, facing: person.facing };
}
