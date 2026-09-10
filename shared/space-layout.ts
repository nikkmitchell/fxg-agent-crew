/**
 * Where things are in the room.
 *
 * DATA, NOT CODE, and shared deliberately. The server needs these coordinates
 * to decide where an agent should walk to; the browser needs them to draw the
 * room. If they were written twice, an agent would eventually walk to where the
 * board used to be — and it would look like a movement bug rather than two
 * numbers disagreeing.
 *
 * Metres, right-handed, Y up. The floor is y = 0 and the room is centred on the
 * origin, so a person entering starts in the middle facing the task board.
 */

export type Vec3 = { x: number; y: number; z: number };

/** A place someone can stand, and what it means that they are standing there. */
export type Station = {
  id: string;
  /** Where an avatar stands when attending to this. */
  stand: Vec3;
  /** Where the surface itself is, for drawing. */
  surface: { position: Vec3; width: number; height: number; rotationY: number };
  label: string;
};

export const ROOM = {
  width: 14,
  depth: 12,
  height: 3.4,
  /** Where a person appears when they arrive. Facing the task board. */
  spawn: { x: 0, y: 0, z: 3.5 } satisfies Vec3,
} as const;

/**
 * The task board fills the far wall, because it is the thing this project is
 * mostly about. Mood boards take the left wall — glanced at rather than worked
 * at. People take the right.
 */
export const STATIONS: Record<string, Station> = {
  taskBoard: {
    id: "taskBoard",
    stand: { x: 0, y: 0, z: -3.6 },
    surface: { position: { x: 0, y: 1.6, z: -5.9 }, width: 10, height: 2.4, rotationY: 0 },
    label: "the task board",
  },
  moodBoard: {
    id: "moodBoard",
    stand: { x: -4.6, y: 0, z: 0 },
    surface: { position: { x: -6.9, y: 1.6, z: 0 }, width: 8, height: 2.6, rotationY: Math.PI / 2 },
    label: "the mood boards",
  },
  people: {
    id: "people",
    stand: { x: 4.6, y: 0, z: 0 },
    surface: { position: { x: 6.9, y: 1.6, z: 0 }, width: 8, height: 2.4, rotationY: -Math.PI / 2 },
    label: "who is here",
  },
};

/**
 * Desks, assigned deterministically by actor id.
 *
 * Deterministic so a given agent is in the same place every time you look —
 * "Plumbline is at the third desk" has to stay true across restarts, or the
 * room teaches you nothing. Same reasoning as the deterministic avatar recipe.
 */
const DESK_ROW_Z = [1.4, 2.9];
const DESK_COLUMN_X = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5];

export function deskFor(actorId: string): Vec3 {
  // FNV-1a, the same hash the avatar recipe uses, so one identity has one
  // stable seat rather than two systems disagreeing about it.
  const hash = [...actorId].reduce(
    (accumulated, character) => Math.imul(accumulated ^ character.charCodeAt(0), 16_777_619) >>> 0,
    2_166_136_261,
  );
  return {
    x: DESK_COLUMN_X[hash % DESK_COLUMN_X.length],
    y: 0,
    z: DESK_ROW_Z[(hash >>> 8) % DESK_ROW_Z.length],
  };
}

export const DESK_CAPACITY = DESK_COLUMN_X.length * DESK_ROW_Z.length;

/**
 * Actor ids that are not people and must never be drawn.
 *
 * An explicit list rather than a name heuristic: "import" is the actor the
 * migration wrote its summary row under, and a rule like "ignore anything
 * without a profile" would also hide a real colleague who has not filled one
 * in — which is precisely who the room should be nudging.
 */
export const NOT_A_PERSON = new Set(["import", "system"]);

/** Metres per second. A walk, not a sprint and not a drift. */
export const WALK_SPEED = 1.4;
