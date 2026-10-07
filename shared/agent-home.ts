import { actorKey } from "./space-layout.js";
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
  /**
   * Who is being placed, so they cannot be told to face themselves.
   *
   * OPTIONAL so every existing caller and test is unchanged, and passed by the
   * one route that places anybody.
   */
  placing?: string,
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
    /**
     * NOBODY FACES THEMSELVES, and this is checked on IDENTITY rather than on
     * geometry because the geometry check below misses it.
     *
     * Found by tools/onboarding-audit.mts against the live site. Asking to be
     * placed somewhere new facing your own name returned 200 and a real angle
     * — pointing back at the spot you were leaving, because `whereIs` answered
     * with where you still were. Two different points, so the same-spot guard
     * never fired.
     *
     * That is the exact failure this function exists to prevent: a confident
     * answer to a question with no meaning. It is also a likely slip, since
     * the documented example is `{ "face": "Nikk2" }` under a path containing
     * your own name, and the result is an agent turned to stare at empty floor
     * with nothing to say why.
     */
    if (placing && actorKey(named) === actorKey(placing)) {
      return { error: `${named} cannot face ${named}; name somebody else, or give an angle` };
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
export const IN_FRONT_DISTANCE = 2.6;
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

/** Ways to stand ALL the agents at once (Nikk 7353): a line facing you or facing away, a half circle, a ring. */
export type Formation = "line-facing" | "line-away" | "half-circle" | "ring";

/** Room between two agents standing side by side, in metres: an avatar's shoulders and a little air. */
export const FORMATION_SPACING = 1.4;

/**
 * Where each of `count` agents stands for a formation, from where the person
 * stands and faces. In front of them for a line or a half circle; all around
 * them for a ring. "Facing" means looking at the person; "away" means looking
 * the way the person looks, so their screens are in view.
 */
export function formationHomes(person: Person, count: number, kind: Formation): AgentHome[] {
  if (count <= 0) return [];
  const f = person.facing;
  const forward = { x: -Math.sin(f), z: -Math.cos(f) };
  const right = { x: Math.cos(f), z: -Math.sin(f) };
  const toward = (at: { x: number; z: number }) => Math.atan2(at.x - person.at.x, at.z - person.at.z);
  const place = (x: number, z: number, facing?: number): AgentHome => {
    const at = { x, y: 0, z };
    return { at, facing: facing ?? toward(at) };
  };
  if (kind === "line-facing" || kind === "line-away") {
    const ahead = kind === "line-facing" ? 2.6 : 1.6;
    return Array.from({ length: count }, (_, i) => {
      const side = (i - (count - 1) / 2) * FORMATION_SPACING;
      const x = person.at.x + forward.x * ahead + right.x * side;
      const z = person.at.z + forward.z * ahead + right.z * side;
      // A line looks straight out (Nikk 7358): toward you, all parallel, not turned in on you.
      return place(x, z, kind === "line-away" ? f : Math.atan2(Math.sin(f + Math.PI), Math.cos(f + Math.PI)));
    });
  }
  // On an arc wide enough that neighbours are about a spacing apart, never closer than 1.6 m.
  const span = kind === "ring" ? Math.PI * 2 : Math.PI;
  const radius = Math.max(1.6, (FORMATION_SPACING * (kind === "ring" ? count : Math.max(count - 1, 1))) / span);
  return Array.from({ length: count }, (_, i) => {
    // Angle from straight ahead, positive to the person's right.
    const angle = kind === "ring" ? (i / count) * span : count === 1 ? 0 : -Math.PI / 2 + (i / (count - 1)) * Math.PI;
    const dx = forward.x * Math.cos(angle) + right.x * Math.sin(angle);
    const dz = forward.z * Math.cos(angle) + right.z * Math.sin(angle);
    return place(person.at.x + dx * radius, person.at.z + dz * radius);
  });
}
