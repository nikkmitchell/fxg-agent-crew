/**
 * IKEBANA: a low vase and a basket of flowers. Choose a flower, then point
 * where its bloom should be, above the vase: a stem grows from the vase mouth
 * to there. Everyone arranges the same vase, and it stays until somebody
 * empties it (twice, on the vase). The art is in few stems, and in the space
 * between them.
 */

export const FLOWERS = [
  { name: "plum blossom", colour: "#f4b6c8", centre: "#fff3d6" },
  { name: "camellia", colour: "#c8283a", centre: "#f5d05a" },
  { name: "chrysanthemum", colour: "#f2c14e", centre: "#b9772a" },
  { name: "iris", colour: "#5b4bb7", centre: "#f3d35a" },
  { name: "white lily", colour: "#f6f3ea", centre: "#e9b44c" },
] as const;

/** The most stems in the vase: ikebana is about restraint. */
export const MOST_STEMS = 12;
/** How far from the vase mouth a bloom may be, in metres. */
export const REACH = 0.55;

/** A stem: which flower, and where its bloom is, from the vase mouth. */
export type Stem = { flower: number; x: number; y: number; z: number; by: string };
export type Vase = { stems: Stem[]; revision: number };
export type VaseChange = { action: "place"; flower: unknown; x: unknown; y: unknown; z: unknown } | { action: "empty" };
export type VaseEvent = { kind: "place"; stem: Stem; revision: number; dropped: number } | { kind: "empty"; by: string; revision: number };

export function emptyVase(): Vase {
  return { stems: [], revision: 0 };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export function applyVase(vase: Vase, change: VaseChange, by: string): { vase: Vase; event: VaseEvent } | { refused: string } {
  const revision = vase.revision + 1;
  if (change.action === "empty") {
    if (!vase.stems.length) return { refused: "The vase is already empty." };
    return { vase: { stems: [], revision }, event: { kind: "empty", by, revision } };
  }
  const { flower, x, y, z } = change;
  if (typeof flower !== "number" || !Number.isInteger(flower) || flower < 0 || flower >= FLOWERS.length) return { refused: "No such flower." };
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return { refused: "Where should it go?" };
  const [px, py, pz] = [x, y, z] as number[];
  if (py < 0.05 || Math.hypot(px, py, pz) > REACH) return { refused: "A bloom has to be above the vase, within reach of it." };
  const stem: Stem = { flower, x: round(px), y: round(py), z: round(pz), by };
  const all = [...vase.stems, stem];
  const dropped = Math.max(0, all.length - MOST_STEMS);
  return { vase: { stems: all.slice(dropped), revision }, event: { kind: "place", stem, revision, dropped } };
}

export function applyVaseEvent(vase: Vase, event: VaseEvent): Vase | null {
  if (event.revision <= vase.revision) return vase;
  if (event.revision !== vase.revision + 1) return null;
  if (event.kind === "empty") return { stems: [], revision: event.revision };
  return { stems: [...vase.stems.slice(event.dropped), event.stem], revision: event.revision };
}

export function parseVase(value: unknown): Vase | null {
  if (!value || typeof value !== "object") return null;
  const vase = value as Partial<Vase>;
  return Array.isArray(vase.stems) && typeof vase.revision === "number" ? { stems: vase.stems, revision: vase.revision } : null;
}
