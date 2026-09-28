/**
 * A THOUSAND PAPER CRANES (senbazuru): the room folds them together, one at a
 * time, over days. Tap the folding table and a crane in the paper you chose
 * joins the strings hanging overhead, for everyone, and stays. When the
 * thousandth is folded, the old story says a wish is granted; the strings glow,
 * and anyone may then release them all to begin again.
 */

export const THOUSAND = 1000;
/** Cranes on one string, top to bottom. */
export const PER_STRING = 25;
export const PAPERS = ["#e8dcc8", "#d9443b", "#f0a830", "#3b6fb6", "#57a05f", "#c77dbb", "#f2f0ea", "#1f2a44"] as const;

export type Crane = { paper: number; by: string };
export type Cranes = { cranes: Crane[]; revision: number };
export type CraneChange = { action: "fold"; paper: unknown } | { action: "release" };
export type CraneEvent = { kind: "fold"; crane: Crane; revision: number } | { kind: "release"; by: string; revision: number };

export function noCranes(): Cranes {
  return { cranes: [], revision: 0 };
}

export function applyCranes(state: Cranes, change: CraneChange, by: string): { cranes: Cranes; event: CraneEvent } | { refused: string } {
  const revision = state.revision + 1;
  if (change.action === "release") {
    if (state.cranes.length < THOUSAND) return { refused: `The strings are released at a thousand; ${THOUSAND - state.cranes.length} to go.` };
    return { cranes: { cranes: [], revision }, event: { kind: "release", by, revision } };
  }
  if (state.cranes.length >= THOUSAND) return { refused: "A thousand cranes. Make a wish, then release them to begin again." };
  const paper = typeof change.paper === "number" && Number.isInteger(change.paper) && change.paper >= 0 && change.paper < PAPERS.length ? change.paper : 0;
  const crane = { paper, by };
  return { cranes: { cranes: [...state.cranes, crane], revision }, event: { kind: "fold", crane, revision } };
}

export function applyCraneEvent(state: Cranes, event: CraneEvent): Cranes | null {
  if (event.revision <= state.revision) return state;
  if (event.revision !== state.revision + 1) return null;
  if (event.kind === "release") return { cranes: [], revision: event.revision };
  return { cranes: [...state.cranes, event.crane], revision: event.revision };
}

export function parseCranes(value: unknown): Cranes | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<Cranes>;
  return Array.isArray(state.cranes) && typeof state.revision === "number" ? { cranes: state.cranes, revision: state.revision } : null;
}

/**
 * Where crane `index` hangs, relative to the table: forty strings in two rings
 * overhead, each filled top to bottom before the next begins.
 */
export function craneAt(index: number): { x: number; y: number; z: number; turn: number } {
  const string = Math.floor(index / PER_STRING);
  const along = index % PER_STRING;
  const inner = string < 16;
  const slot = inner ? string : string - 16;
  const count = inner ? 16 : 24;
  const radius = inner ? 0.7 : 1.15;
  const angle = (slot / count) * Math.PI * 2 + (inner ? 0 : 0.13);
  return {
    x: Math.cos(angle) * radius,
    y: 2.95 - along * 0.045,
    z: Math.sin(angle) * radius,
    turn: angle + along * 0.7,
  };
}
