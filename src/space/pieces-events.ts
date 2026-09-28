import { useEffect, useState } from "react";
import { allShown, applyPieces, type PiecesChange, type PiecesEvent } from "../../shared/room-pieces";
import { space } from "../space-client";

/** Toggles on the guide board, as they arrive over the room socket (shared/room-pieces.ts). */
const listeners = new Set<(event: PiecesEvent) => void>();
let previewPieces = allShown();

export function isMenuPreviewPath(pathname: string, development: boolean): boolean {
  return development && pathname.endsWith("/dev/menu-preview.html");
}

/** The visual preview has no room BFF or socket; keep its toggles local to that dev page. */
function isMenuPreview(): boolean {
  return typeof window !== "undefined" && isMenuPreviewPath(window.location.pathname, import.meta.env.DEV);
}

export function onPiecesChange(listener: (event: PiecesEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function piecesChanged(event: PiecesEvent): void {
  for (const listener of listeners) listener(event);
}

/** Change a room toggle, or its in-memory preview equivalent on the dev page. */
export function changeHiddenPieces(change: PiecesChange) {
  if (!isMenuPreview()) return space.togglePieces(change);
  const result = applyPieces(previewPieces, change, "preview");
  if ("refused" in result) return Promise.reject(new Error(result.refused));
  previewPieces = result.pieces;
  piecesChanged(result.event);
  return Promise.resolve({ event: result.event });
}

/**
 * The pieces this room has hidden, kept current. Each event carries the whole
 * (short) hidden list, so there is nothing to miss: the newest revision wins.
 */
export function useHiddenPieces(): { hidden: ReadonlySet<string>; revision: number } {
  const [state, setState] = useState<{ hidden: ReadonlySet<string>; revision: number }>({ hidden: new Set(), revision: 0 });
  useEffect(() => {
    let live = true;
    const stop = onPiecesChange((event) => setState((now) => (event.revision > now.revision ? { hidden: new Set(event.hidden), revision: event.revision } : now)));
    if (isMenuPreview()) {
      setState({ hidden: new Set(previewPieces.hidden), revision: previewPieces.revision });
    } else {
      space.pieces().then((answer) => {
        if (live) setState((now) => (answer.pieces.revision >= now.revision ? { hidden: new Set(answer.pieces.hidden), revision: answer.pieces.revision } : now));
      }).catch(() => {});
    }
    return () => {
      live = false;
      stop();
    };
  }, []);
  return state;
}
