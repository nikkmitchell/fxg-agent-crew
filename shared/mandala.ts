/**
 * THE SAND MANDALA: a round plate that everyone pours coloured sand onto,
 * grain by grain, over days, and that is swept away when it is done.
 *
 * Tibetan monks make these over weeks and then sweep them into a jar and pour
 * the sand into running water: the practice is in the making and the letting
 * go, not the keeping. Here anyone pours; every pour is mirrored round the
 * plate eight times over (sixteen with the reflections), so even a single
 * clumsy line comes out as a symmetric pattern; and the SWEEP clears it for
 * everyone, spiralling the sand into the centre. (Sill, 5529: the swept
 * colours can feed the Stillness Tree.)
 *
 * WHAT IS KEPT: pours, as polar points (radius 0..1 of the plate, angle) and a
 * colour, until the sweep. Stored per room and told to the room as changes.
 */

/** The plate's radius in metres. */
export const PLATE_RADIUS = 0.55;
/** How many ways round each pour is repeated. */
export const FOLDS = 8;
/** The colours of sand on offer: white, saffron, vermilion, lapis, jade, ink. */
export const SANDS = ["#f4efe2", "#f2a81d", "#d8402c", "#2f5fb3", "#3f9b6a", "#222226"] as const;
/** How many pours the plate keeps before the oldest sink under the new. */
export const MAX_POURS = 600;
/** How many points one pour may have. */
export const POUR_POINTS = 120;
/** Points closer together than this (in plate radii) are one point. */
export const GRAIN_STEP = 0.012;

/** A point on the plate: radius 0..1, angle in radians. */
export type PlatePoint = [r: number, a: number];
export type Pour = { id: string; by: string; colour: number; points: PlatePoint[] };

export type Mandala = {
  pours: Pour[];
  revision: number;
  /** How many times this plate has been swept, and the colours of the last sweep. */
  sweeps: number;
  lastSwept: { by: string; colours: number[] } | null;
};

export type MandalaChange = { action: "pour"; colour: unknown; points: unknown } | { action: "sweep" };

export type MandalaEvent =
  | { kind: "pour"; pour: Pour; revision: number; dropped: number }
  | { kind: "sweep"; by: string; colours: number[]; revision: number };

export function emptyMandala(): Mandala {
  return { pours: [], revision: 0, sweeps: 0, lastSwept: null };
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const wrap = (angle: number) => {
  const full = Math.PI * 2;
  return ((angle % full) + full) % full;
};

/** A pour's points from what a client sent: numbers, on the plate, thinned. Null when nothing is left. */
export function cleanPour(points: unknown): PlatePoint[] | null {
  if (!Array.isArray(points)) return null;
  const kept: PlatePoint[] = [];
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2) continue;
    const [r, a] = point as unknown[];
    if (typeof r !== "number" || typeof a !== "number" || !Number.isFinite(r) || !Number.isFinite(a)) continue;
    if (r < 0 || r > 1) continue;
    const next: PlatePoint = [round(r), round(wrap(a))];
    const last = kept[kept.length - 1];
    if (last) {
      const dx = last[0] * Math.cos(last[1]) - next[0] * Math.cos(next[1]);
      const dy = last[0] * Math.sin(last[1]) - next[0] * Math.sin(next[1]);
      if (Math.hypot(dx, dy) < GRAIN_STEP) continue;
    }
    kept.push(next);
    if (kept.length >= POUR_POINTS) break;
  }
  return kept.length ? kept : null;
}

export function applyMandala(
  mandala: Mandala,
  change: MandalaChange,
  by: string,
  makeId: () => string,
): { mandala: Mandala; event: MandalaEvent } | { refused: string } {
  const revision = mandala.revision + 1;
  if (change.action === "pour") {
    const colour = change.colour;
    if (typeof colour !== "number" || !Number.isInteger(colour) || colour < 0 || colour >= SANDS.length) return { refused: "No such sand." };
    const points = cleanPour(change.points);
    if (!points) return { refused: "That pour missed the plate." };
    const pour: Pour = { id: makeId(), by, colour, points };
    const all = [...mandala.pours, pour];
    const dropped = Math.max(0, all.length - MAX_POURS);
    return { mandala: { ...mandala, pours: all.slice(dropped), revision }, event: { kind: "pour", pour, revision, dropped } };
  }
  if (change.action === "sweep") {
    if (mandala.pours.length === 0) return { refused: "The plate is already bare." };
    const colours = [...new Set(mandala.pours.map((pour) => pour.colour))].sort((a, b) => a - b);
    return {
      mandala: { pours: [], revision, sweeps: mandala.sweeps + 1, lastSwept: { by, colours } },
      event: { kind: "sweep", by, colours, revision },
    };
  }
  return { refused: "Unknown change." };
}

/** Apply what the room was told. Null when this client missed a change and must read again. */
export function applyMandalaEvent(mandala: Mandala, event: MandalaEvent): Mandala | null {
  if (event.revision <= mandala.revision) return mandala;
  if (event.revision !== mandala.revision + 1) return null;
  if (event.kind === "pour") return { ...mandala, pours: [...mandala.pours.slice(event.dropped), event.pour], revision: event.revision };
  return { pours: [], revision: event.revision, sweeps: mandala.sweeps + 1, lastSwept: { by: event.by, colours: event.colours } };
}

export function parseMandala(value: unknown): Mandala | null {
  if (!value || typeof value !== "object") return null;
  const mandala = value as Partial<Mandala>;
  if (!Array.isArray(mandala.pours) || typeof mandala.revision !== "number") return null;
  return { pours: mandala.pours, revision: mandala.revision, sweeps: mandala.sweeps ?? 0, lastSwept: mandala.lastSwept ?? null };
}

/**
 * Every place one point lands: repeated FOLDS times round the plate, and
 * mirrored within each fold. As x, y in plate radii from the centre.
 */
export function mirrored([r, a]: PlatePoint): [number, number][] {
  const slice = (Math.PI * 2) / FOLDS;
  const within = wrap(a) % slice;
  const places: [number, number][] = [];
  for (let fold = 0; fold < FOLDS; fold += 1) {
    for (const angle of [fold * slice + within, (fold + 1) * slice - within]) {
      places.push([r * Math.cos(angle), r * Math.sin(angle)]);
    }
  }
  return places;
}
