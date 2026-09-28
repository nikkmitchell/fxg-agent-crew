import { ROOM_GUIDE } from "./room-guide.js";

/**
 * WHAT THE ROOM SHOWS: the guide board is a board of toggles. Nikk
 * (2026-09-28): "now there is too much stuff there ... a UI board with
 * toggles, so you can toggle things on and off to hide what is currently
 * being shown in the room". A toggle hides a piece for EVERYONE in the room,
 * and the room remembers it; turning it back on brings it back as it was
 * (stored pieces keep their state while hidden).
 */

/** Things in the room that are not on the guide's list but can be hidden too. */
export const EXTRA_PIECES = ["Star map", "Moon", "Water clock", "Paper boats", "Petals", "Sound bath", "Dawn"] as const;

/** Every piece that has a toggle. The orb is not here: it has its own switch in the room menu. */
export const TOGGLEABLE: readonly string[] = [...ROOM_GUIDE.map((entry) => entry.name).filter((name) => name !== "Breathing orb"), ...EXTRA_PIECES];

export type RoomPieces = { hidden: string[]; revision: number };
export type PiecesChange = { name: unknown; shown: unknown } | { all: unknown };
export type PiecesEvent = { hidden: string[]; revision: number; by: string };

export function allShown(): RoomPieces {
  return { hidden: [], revision: 0 };
}

/** Turn one piece on or off, or every piece at once ({ all: true } shows all, false hides all). */
export function applyPieces(state: RoomPieces, change: PiecesChange, by: string): { pieces: RoomPieces; event: PiecesEvent } | { refused: string } {
  let hidden: string[];
  if ("all" in change) {
    if (typeof change.all !== "boolean") return { refused: "Say whether to show all or hide all." };
    hidden = change.all ? [] : [...TOGGLEABLE];
  } else {
    if (typeof change.name !== "string" || !TOGGLEABLE.includes(change.name)) return { refused: "There is no such thing in the room to toggle." };
    if (typeof change.shown !== "boolean") return { refused: "Say whether to show it or hide it." };
    const without = state.hidden.filter((name) => name !== change.name);
    hidden = change.shown ? without : [...without, change.name];
  }
  const revision = state.revision + 1;
  return { pieces: { hidden, revision }, event: { hidden, revision, by } };
}

export function parsePieces(value: unknown): RoomPieces | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<RoomPieces>;
  return Array.isArray(state.hidden) && typeof state.revision === "number" ? { hidden: state.hidden.filter((name) => typeof name === "string"), revision: state.revision } : null;
}
