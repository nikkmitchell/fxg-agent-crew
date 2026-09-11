/**
 * Where things are in the void.
 *
 * DATA, NOT CODE, and shared deliberately. The server needs these coordinates
 * to decide where an agent should walk to; the browser needs them to place the
 * panels. If they were written twice, an agent would eventually walk to where a
 * panel used to be — and it would look like a movement bug rather than two
 * numbers disagreeing.
 *
 * Metres, right-handed, Y up. There is no room: no walls, no floor, no ceiling.
 * Three panels hang in empty space in a shallow arc, and people stand among
 * them. The bounds below are a comfort rail rather than architecture — they
 * stop somebody drifting out of sight of everything, which in a void is a
 * genuinely unpleasant thing to have happen.
 */

export type Vec3 = { x: number; y: number; z: number };

/** A panel you can stand in front of, and what it means to be standing there. */
export type Station = {
  id: string;
  /** Where an avatar stands when attending to this. */
  stand: Vec3;
  /** The panel itself, for drawing. */
  surface: { position: Vec3; width: number; height: number; rotationY: number };
  label: string;
  /** The app tab this panel shows, embedded as its real self. */
  tab: string;
};

export const ROOM = {
  /**
   * How far anyone may wander before the rail stops them. NOT walls.
   *
   * Generous, because it costs nothing in a void and being cramped costs
   * something. It was 16 x 14, which put the resting places OUTSIDE it — so
   * the clamp pulled every idle figure onto the same point on the boundary and
   * they stood inside one another. `space-layout.test.ts` now fails if any
   * fixed position in this file falls outside these numbers.
   */
  width: 20,
  depth: 22,
  /**
   * Where a person appears when they arrive, facing the board panel.
   *
   * Far enough back that all three panels are comfortably in view at once.
   * Closer in, the side panels were so foreshortened they read as slivers and
   * the centre one filled the whole window — which defeats the point of
   * arranging them in space at all.
   */
  spawn: { x: 0, y: 0, z: 6.2 } satisfies Vec3,
} as const;

/**
 * A shallow arc of three panels, all facing the spawn point.
 *
 * Angled inward rather than laid flat on imaginary walls: with nothing else in
 * the scene, a panel you are looking at edge-on is simply gone, and there is no
 * room geometry left to tell you it is there.
 */
const PANEL = { width: 4.2, height: 2.6 } as const;

export const STATIONS: Record<string, Station> = {
  taskBoard: {
    id: "taskBoard",
    stand: { x: 0, y: 0, z: 2.2 },
    surface: { position: { x: 0, y: 1.65, z: -1.2 }, ...PANEL, rotationY: 0 },
    label: "Board",
    tab: "board",
  },
  moodBoard: {
    id: "moodBoard",
    stand: { x: -4.2, y: 0, z: 2.4 },
    surface: { position: { x: -5.1, y: 1.65, z: 0.6 }, ...PANEL, rotationY: 0.52 },
    label: "Mood boards",
    tab: "mood",
  },
  people: {
    id: "people",
    stand: { x: 4.2, y: 0, z: 2.4 },
    surface: { position: { x: 5.1, y: 1.65, z: 0.6 }, ...PANEL, rotationY: -0.52 },
    label: "People",
    tab: "people",
  },
};

/**
 * Desks, assigned deterministically by actor id.
 *
 * Deterministic so a given agent is in the same place every time you look —
 * "Plumbline stands over there" has to stay true across restarts, or the space
 * teaches you nothing. Same reasoning as the deterministic avatar recipe.
 *
 * Behind the spawn point, so a crowd of idle figures never stands between you
 * and a panel you are trying to read — but only just behind it. In a void,
 * putting people far from everything else leaves them floating alone in the
 * dark, which is a worse answer than standing slightly in the way.
 */
const DESK_ROW_Z = [7.0, 8.2];
const DESK_COLUMN_X = [-4.5, -2.7, -0.9, 0.9, 2.7, 4.5];

export function deskFor(actorId: string): Vec3 {
  // FNV-1a, the same hash the avatar recipe uses, so one identity has one
  // stable place to stand rather than two systems disagreeing about it.
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
 * in — which is precisely who this space should be nudging.
 */
export const NOT_A_PERSON = new Set(["import", "system"]);

/** Metres per second. A walk, not a sprint and not a drift. */
export const WALK_SPEED = 1.4;
