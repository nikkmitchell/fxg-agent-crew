/**
 * THE ZEN SAND GARDEN: a tray of sand that everyone in the room rakes
 * together, and that remembers.
 *
 * Nikk (5483): "maybe shouldnt be cleared when session ends, so there can be
 * like building up of spaces"; (5491) "Love the idea of a collaborative sand
 * garden". Every groove anybody draws stays until somebody smooths the sand,
 * so the garden is the room's handwriting over days.
 *
 * WHAT IS KEPT: strokes (a rake's path, as points across the tray) and a few
 * stones. A stroke is drawn with a three-tined rake, so one path makes three
 * parallel grooves, the way a real garden is raked. Coordinates are in the
 * tray's own metres, from its centre, x across and z toward you.
 *
 * PURE: the server applies changes with `applyGarden`, the client draws what
 * it holds, and both agree by `revision`.
 */

/** The tray's inner size in metres. */
export const TRAY = { width: 1.2, depth: 0.8 } as const;
/** How many strokes the garden keeps; the oldest are raked over first. */
export const MAX_STROKES = 400;
/** How many points one stroke may have: about four metres of raking. */
export const MAX_POINTS = 160;
/** Points closer together than this are one point. */
export const POINT_STEP = 0.012;
/** How many stones there are. They are moved, never added or removed. */
export const STONE_COUNT = 3;

export type GardenPoint = [x: number, z: number];
export type GardenStroke = { id: string; by: string; points: GardenPoint[] };
export type GardenStone = { x: number; z: number; size: number; turn: number };

export type Garden = {
  strokes: GardenStroke[];
  stones: GardenStone[];
  revision: number;
  /** Who smoothed the sand last, and when, so an empty garden can say why. */
  smoothedBy: string | null;
};

export type GardenChange =
  | { action: "stroke"; points: unknown }
  | { action: "stone"; index: unknown; x: unknown; z: unknown }
  | { action: "smooth" };

/** What the room's clients are told: the change, already applied, and the revision it made. */
export type GardenEvent =
  | { kind: "stroke"; stroke: GardenStroke; revision: number; dropped: number }
  | { kind: "stone"; index: number; stone: GardenStone; revision: number }
  | { kind: "smooth"; by: string; revision: number };

export function emptyGarden(): Garden {
  return {
    strokes: [],
    // Three stones as a real garden has them: uneven, off-centre, never in a row.
    stones: [
      { x: -0.3, z: -0.12, size: 0.07, turn: 0.4 },
      { x: 0.24, z: 0.1, size: 0.05, turn: 1.9 },
      { x: 0.36, z: -0.2, size: 0.035, turn: 3.1 },
    ],
    revision: 0,
    smoothedBy: null,
  };
}

const inside = (x: number, z: number) => Math.abs(x) <= TRAY.width / 2 && Math.abs(z) <= TRAY.depth / 2;
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * A stroke's points from what a client sent: numbers only, inside the tray,
 * thinned so that points closer than POINT_STEP are one, and at most
 * MAX_POINTS. Null when nothing drawable is left.
 */
export function cleanStroke(points: unknown): GardenPoint[] | null {
  if (!Array.isArray(points)) return null;
  const kept: GardenPoint[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) continue;
    const [x, z] = point as unknown[];
    if (typeof x !== "number" || typeof z !== "number" || !Number.isFinite(x) || !Number.isFinite(z)) continue;
    if (!inside(x, z)) continue;
    const last = kept[kept.length - 1];
    if (last && Math.hypot(last[0] - x, last[1] - z) < POINT_STEP) continue;
    kept.push([round(x), round(z)]);
    if (kept.length >= MAX_POINTS) break;
  }
  return kept.length >= 2 ? kept : null;
}

export function applyGarden(
  garden: Garden,
  change: GardenChange,
  by: string,
  makeId: () => string,
): { garden: Garden; event: GardenEvent } | { refused: string } {
  const revision = garden.revision + 1;
  if (change.action === "stroke") {
    const points = cleanStroke(change.points);
    if (!points) return { refused: "That stroke had nothing in the sand." };
    const stroke: GardenStroke = { id: makeId(), by, points };
    const all = [...garden.strokes, stroke];
    const dropped = Math.max(0, all.length - MAX_STROKES);
    return {
      garden: { ...garden, strokes: all.slice(dropped), revision },
      event: { kind: "stroke", stroke, revision, dropped },
    };
  }
  if (change.action === "stone") {
    const index = change.index;
    const x = change.x;
    const z = change.z;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= garden.stones.length) return { refused: "No such stone." };
    if (typeof x !== "number" || typeof z !== "number" || !inside(x, z)) return { refused: "A stone has to stay in the sand." };
    const stone = { ...garden.stones[index], x: round(x), z: round(z) };
    const stones = garden.stones.map((one, at) => (at === index ? stone : one));
    return { garden: { ...garden, stones, revision }, event: { kind: "stone", index, stone, revision } };
  }
  if (change.action === "smooth") {
    return { garden: { ...garden, strokes: [], revision, smoothedBy: by }, event: { kind: "smooth", by, revision } };
  }
  return { refused: "Unknown change." };
}

/**
 * Apply what the room was told to what this client holds. Null when this
 * client missed something (the revision is not the next one), and must read
 * the whole garden again.
 */
export function applyGardenEvent(garden: Garden, event: GardenEvent): Garden | null {
  if (event.revision <= garden.revision) return garden;
  if (event.revision !== garden.revision + 1) return null;
  switch (event.kind) {
    case "stroke":
      return { ...garden, strokes: [...garden.strokes.slice(event.dropped), event.stroke], revision: event.revision };
    case "stone":
      return { ...garden, stones: garden.stones.map((one, at) => (at === event.index ? event.stone : one)), revision: event.revision };
    case "smooth":
      return { ...garden, strokes: [], revision: event.revision, smoothedBy: event.by };
  }
}

export function parseGarden(value: unknown): Garden | null {
  if (!value || typeof value !== "object") return null;
  const garden = value as Partial<Garden>;
  if (!Array.isArray(garden.strokes) || !Array.isArray(garden.stones) || typeof garden.revision !== "number") return null;
  const stones = garden.stones.length === STONE_COUNT ? garden.stones : emptyGarden().stones;
  return { strokes: garden.strokes, stones, revision: garden.revision, smoothedBy: garden.smoothedBy ?? null };
}

/**
 * The three tines of a rake along a path: the same path offset to each side,
 * perpendicular to the direction of travel. `spacing` is between tines.
 */
export function rakeTines(points: readonly GardenPoint[], spacing = 0.022): GardenPoint[][] {
  const tines: GardenPoint[][] = [[], [], []];
  points.forEach((point, index) => {
    const from = points[Math.max(0, index - 1)];
    const to = points[Math.min(points.length - 1, index + 1)];
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const length = Math.hypot(dx, dz) || 1;
    const nx = -dz / length;
    const nz = dx / length;
    [-1, 0, 1].forEach((side, tine) => tines[tine].push([point[0] + nx * spacing * side, point[1] + nz * spacing * side]));
  });
  return tines;
}
