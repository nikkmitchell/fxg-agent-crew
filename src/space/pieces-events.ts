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
 *
 * READ AGAIN whenever `refreshKey` changes (the room connection opening, a
 * different room) and every minute: Nikk (2026-09-28), "when rejoining the
 * room, sometimes everything is showing and it doesn't update till I
 * interact with the board". It was read once, when the scene first mounted,
 * and a rejoin missed every toggle made while away.
 */
export function useHiddenPieces(refreshKey = ""): { hidden: ReadonlySet<string>; revision: number } {
  const [state, setState] = useState<{ hidden: ReadonlySet<string>; revision: number }>({ hidden: new Set(), revision: 0 });
  useEffect(() => {
    const stop = onPiecesChange((event) => {
      const pieces = parsePieces(event);
      if (pieces) setState((now) => (pieces.revision > now.revision ? { hidden: new Set(pieces.hidden), revision: pieces.revision } : now));
    });
    return stop;
  }, []);
  useEffect(() => {
    let live = true;
    const read = () =>
      space.pieces().then((answer) => {
        // Checked HERE, not inside the state update: a bad answer (the dev
        // preview's HTML fallback, a proxy error page) must be ignored, and a
        // throw inside setState would take the whole scene down (Lumenfold, 5702).
        const pieces = parsePieces((answer as { pieces?: unknown } | null)?.pieces);
        // The server's answer is the truth for THIS room: take it whole, even
        // at a lower revision (a different room counts from its own zero).
        if (live && pieces) setState({ hidden: new Set(pieces.hidden), revision: pieces.revision });
      }).catch(() => {});
    void read();
    const timer = window.setInterval(() => void read(), 60_000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [refreshKey]);
  return state;
}
