import { useEffect, useState } from "react";
import type { PiecesEvent } from "../../shared/room-pieces";
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
      if (live) setState((now) => (answer.pieces.revision >= now.revision ? { hidden: new Set(answer.pieces.hidden), revision: answer.pieces.revision } : now));
    }).catch(() => {});
    const stop = onPiecesChange((event) => setState((now) => (event.revision > now.revision ? { hidden: new Set(event.hidden), revision: event.revision } : now)));
    return () => {
      live = false;
      stop();
    };
  }, []);
  return state;
}
