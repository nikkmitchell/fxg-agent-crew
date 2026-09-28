import { useEffect, useState } from "react";
import { parsePieces, type PiecesEvent } from "../../shared/room-pieces";
import { space } from "../space-client";

/** Toggles on the guide board, as they arrive over the room socket (shared/room-pieces.ts). */
const listeners = new Set<(event: PiecesEvent) => void>();

export function onPiecesChange(listener: (event: PiecesEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function piecesChanged(event: PiecesEvent): void {
  for (const listener of listeners) listener(event);
}

/**
 * The pieces this room has hidden, kept current. Each event carries the whole
 * (short) hidden list, so there is nothing to miss: the newest revision wins.
 */
export function useHiddenPieces(): { hidden: ReadonlySet<string>; revision: number } {
  const [state, setState] = useState<{ hidden: ReadonlySet<string>; revision: number }>({ hidden: new Set(), revision: 0 });
  useEffect(() => {
    let live = true;
    space.pieces().then((answer) => {
      // Checked HERE, not inside the state update: a bad answer (the dev
      // preview's HTML fallback, a proxy error page) must be ignored, and a
      // throw inside setState would take the whole scene down (Lumenfold, 5702).
      const pieces = parsePieces((answer as { pieces?: unknown } | null)?.pieces);
      if (live && pieces) setState((now) => (pieces.revision >= now.revision ? { hidden: new Set(pieces.hidden), revision: pieces.revision } : now));
    }).catch(() => {});
    const stop = onPiecesChange((event) => {
      const pieces = parsePieces(event);
      if (pieces) setState((now) => (pieces.revision > now.revision ? { hidden: new Set(pieces.hidden), revision: pieces.revision } : now));
    });
    return () => {
      live = false;
      stop();
    };
  }, []);
  return state;
}
