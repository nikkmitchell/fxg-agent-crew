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
  /**
   * True when a headset draws this panel itself instead of showing a
   * photograph of it. Only the chat is: the server's renderer holds no
   * WebHarness token, so photographing it produces a picture of the sentence
   * saying the room could not be read. Photographing it anyway would be a
   * headless Chrome page load every fifteen seconds for an image nobody can
   * use.
   */
  drawnInSession?: boolean;
};

/**
 * HOW FAR YOU MAY WALK: as far as you like.
 *
 * Nikk: "can you remove the limited walking boundary we don't want to have any
 * limit to walking".
 *
 * There used to be a rail at the edge of ROOM. It is gone. What is left is not
 * a boundary but an ARITHMETIC BOUND, and the difference matters: nothing here
 * is meant to stop anybody, it exists so a position stays a usable number.
 *
 * WHY A BOUND AT ALL, when the instruction was "no limit". A position is not
 * only yours — other people's maths is done against it. `standingRoomNear`
 * searches outward from where you are, `conversationPlace` puts an agent at
 * arm's length from you, and a screen hangs at a fixed offset in front of you.
 * At 1e9 those calculations lose all their precision, and an agent sent to
 * stand beside you can no longer be told apart from one standing on you. At
 * Infinity or NaN they stop producing numbers at all, and a single bad sample
 * from one client would put every figure in the room at a broken coordinate.
 *
 * So: 10 km, which is 500 room-widths and about two hours' walk. Nobody will
 * ever reach it on foot, and doubles stay exact well past it. It is a guard
 * against a typo or a garbage packet, not against a person going for a walk.
 */
export const WORLD = { half: 10_000 } as const;

/** Keep a position finite and sane. NOT a wall — see WORLD. */
export function clampToWorld(at: { x: number; z: number }): { x: number; y: number; z: number } {
  const sane = (value: number) =>
    Number.isFinite(value) ? Math.max(-WORLD.half, Math.min(WORLD.half, value)) : 0;
  return { x: sane(at.x), y: 0, z: sane(at.z) };
}

export const ROOM = {
  /**
   * The furnished part of the void: where the panels are, where people arrive,
   * and where an unplaced figure rests. NOT a limit on walking any more — see
   * WORLD above. `space-layout.test.ts` fails if any fixed position in this
   * file falls outside these numbers.
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
 * A shallow arc of panels, all facing the spawn point.
 *
 * Angled inward rather than laid flat on imaginary walls: with nothing else in
 * the scene, a panel you are looking at edge-on is simply gone, and there is no
 * room geometry left to tell you it is there.
 *
 * COMPUTED RATHER THAN TYPED OUT, since the fourth panel arrived. Three
 * hand-placed positions were fine; four meant re-deriving all of them by hand
 * and getting the spacing wrong, and a fifth would mean doing it again. The arc
 * below spaces whatever is in the catalogue evenly and turns each panel to face
 * the person standing at the focus.
 */
const PANEL = { width: 4.0, height: 2.5 } as const;

/**
 * The circle the panels hang on.
 *
 * The focus sits just in front of the spawn point rather than on it, so the
 * outermost panels are beside you rather than behind you. The radius is the
 * reading distance: closer and the centre panel fills your view, further and
 * the text on it stops being legible in a headset.
 *
 * THE ARC GETS WIDER RATHER THAN TIGHTER as panels are added, and it is worth
 * saying which way that compromise falls. Panels wide enough to read cannot all
 * sit within one view: fitting them would mean pushing them far enough away
 * that the text goes. So the inner panels are in front of you and the outer
 * ones are a head-turn to either side. That is right in a headset, where
 * turning your head costs nothing and is most of what a room is for, and it is
 * why the flat view lets you drag to look. Somebody who would rather have
 * fewer, closer panels closes one — which is most of what the picker is for.
 */
/**
 * The point every panel faces, and the point a dragged panel turns back toward.
 *
 * EXPORTED, because `panel-place.ts` needs the identical point to aim a panel
 * somebody has just dragged. It had its own copy of these coordinates for a
 * day, which is the exact failure this file's own opening comment warns about:
 * two numbers that must agree, written twice.
 */
export const ARC_FOCUS = { x: 0, z: 5.2 } as const;

/**
 * How far in front of its panel somebody stands to attend to it.
 *
 * EXPORTED for the same reason. `panel-place.ts` had `const back = 1.8` and a
 * comment saying it matched this one — a comment is not a mechanism.
 */
export const STAND_BACK = 1.8;

const ARC = {
  focus: ARC_FOCUS,
  radius: 7.0,
  /**
   * The angle between one panel and the next, NOT the width of the whole arc.
   *
   * Fixing the total spread meant that adding the fifth panel silently squeezed
   * the other four into each other — the overlap test caught it, which is why
   * that test exists. Spacing them by a constant angle instead keeps every gap
   * the same whatever the catalogue holds, and the arc simply gets wider as the
   * room gains panels. At this radius it leaves about half a metre between
   * neighbours.
   */
  step: (37 * Math.PI) / 180,
} as const;

/**
 * One panel's place on the arc, by its position in the catalogue.
 *
 * `turn` is measured from straight ahead, negative to the left. A panel facing
 * the focus has `rotationY = -turn`, because a plane with no rotation faces +z
 * and the focus is at +z from every panel on the arc.
 */
export function arcPlacement(index: number, count: number): {
  surface: Station["surface"];
  stand: Vec3;
} {
  // A single panel goes straight ahead rather than at one end of nothing.
  const spread = ARC.step * (count - 1);
  const turn = count < 2 ? 0 : -spread / 2 + ARC.step * index;
  const x = ARC.focus.x + ARC.radius * Math.sin(turn);
  const z = ARC.focus.z - ARC.radius * Math.cos(turn);
  // Toward the focus, which is also the direction the panel faces.
  const toward = { x: Math.sin(turn) * -1, z: Math.cos(turn) };
  return {
    surface: { position: { x, y: 1.65, z }, ...PANEL, rotationY: -turn },
    stand: { x: x + toward.x * STAND_BACK, y: 0, z: z + toward.z * STAND_BACK },
  };
}

/**
 * Every panel this room knows how to show, left to right along the arc.
 *
 * ORDER IS POSITION, so this list is not alphabetical and should not be sorted.
 *
 * The Board sits IN THE MIDDLE because it is the thing people come here to look
 * at, and the two conversation panels — what was said in the room, and the
 * WebHarness chat — are together at one end, because you talk while facing the
 * room rather than while reading.
 *
 * That claim used to be a comment and the comment went stale the moment it
 * mattered: adding a fifth panel pushed the Board off centre and nothing
 * noticed, because the tests checked spacing and facing but not which panel you
 * are looking at when you arrive. There is now a test for it.
 */
const CATALOGUE: { id: string; label: string; tab: string; drawnInSession?: boolean }[] = [
  { id: "moodBoard", label: "Mood boards", tab: "mood" },
  { id: "people", label: "People", tab: "people" },
  { id: "taskBoard", label: "Board", tab: "board" },
  /**
   * THE ROOM'S OWN TRANSCRIPT, which is not the same thing as the chat below.
   *
   * Added because Nikk stood in a headset, spoke four times, and had to ask me
   * in another room whether any of it had come out. The transcript lived in the
   * page's rail — DOM, invisible inside a session — and your own words are not
   * drawn above your own head, because you are not drawn to yourself. So
   * speaking into the room looked exactly like speaking into nothing.
   *
   * Photographed like the boards rather than drawn live: unlike the WebHarness
   * chat, this reads a saha.ing endpoint, and the still renderer holds a real
   * saha.ing session.
   */
  { id: "said", label: "Said in the room", tab: "said" },
  // The WebHarness room, which is where the project is discussed and where
  // tasks are handed to agents. Nikk asked for this one by name; the room's own
  // utterance transcript is a different thing and lives on the Chat tab's
  // sibling, "said".
  { id: "chat", label: "Chat", tab: "chat", drawnInSession: true },
];

export const STATIONS: Record<string, Station> = Object.fromEntries(
  CATALOGUE.map((entry, index) => [
    entry.id,
    { ...entry, ...arcPlacement(index, CATALOGUE.length) } satisfies Station,
  ]),
);

/**
 * Which panels a person sees when they have never said otherwise.
 *
 * All of them. A room that starts half empty makes you go and find a settings
 * page before it shows you anything, and the whole point of the arc is that
 * what you need is already in front of you.
 */
export const DEFAULT_OPEN_PANELS: string[] = CATALOGUE.map((entry) => entry.id);

/**
 * Which way to face on arrival, given what this person has open.
 *
 * The arc is shared and fixed, so somebody who closes everything except the
 * panel at one end of it would otherwise arrive looking at the middle of an
 * empty room with their one panel off the edge of the screen. Turning to face
 * the middle of what they actually have open costs nothing and removes the
 * whole class of "I closed things and now there is nothing there".
 *
 * Yaw in the three.js sense: a camera at yaw 0 looks down -Z, which is straight
 * up the middle of the arc, so a full set of panels returns 0.
 */
export function facingFor(openPanelIds: string[], from: Vec3 = ROOM.spawn): number {
  const open = openPanelIds.map((id) => STATIONS[id]).filter((station) => station !== undefined);
  if (open.length === 0) return 0;
  // The mean of the directions rather than the direction of the mean: two
  // panels either side of you average to a point between them, which is
  // correct, but averaging positions of panels at very different distances
  // would lean toward the far one for no reason.
  let x = 0;
  let z = 0;
  for (const station of open) {
    const dx = station.surface.position.x - from.x;
    const dz = station.surface.position.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    x += dx / length;
    z += dz / length;
  }
  // atan2(x, -z): -Z is yaw 0 and +X is a positive (leftward in three's
  // right-handed Y-up) rotation... which is to say a panel to your right needs
  // a NEGATIVE yaw, hence the sign.
  return Math.atan2(x, -z) * -1;
}

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

/**
 * Stable lookup key for one actor across the room, chat and audit trail.
 *
 * Those systems preserve the spelling they were given, so the same person is
 * currently seen as both `nikk2` and `Nikk2`. Display spelling stays on the
 * occupant; only internal identity lookups use this key.
 */
export function actorKey(actorId: string): string {
  return actorId.trim().toLowerCase();
}

export function deskFor(actorId: string): Vec3 {
  // FNV-1a, the same hash the avatar recipe uses, so one identity has one
  // stable place to stand rather than two systems disagreeing about it.
  const hash = [...actorKey(actorId)].reduce(
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
 * migration wrote its summary row under, "render" is the headless browser that
 * photographs the pages for the headset, and a rule like "ignore anything
 * without a profile" would also hide a real colleague who has not filled one
 * in — which is precisely who this space should be nudging.
 */
export const NOT_A_PERSON = new Set(["import", "system", "render"]);

/** Metres per second. A walk, not a sprint and not a drift. */
export const WALK_SPEED = 1.4;
