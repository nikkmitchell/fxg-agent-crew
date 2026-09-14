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
