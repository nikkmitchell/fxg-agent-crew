import type { CairnEvent } from "../../shared/cairn";

/**
 * Changes to the cairn, as they arrive over the room socket
 * (shared/cairn.ts).
 */
const listeners = new Set<(event: CairnEvent) => void>();

export function onCairnChange(listener: (event: CairnEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cairnChanged(event: CairnEvent): void {
  for (const listener of listeners) listener(event);
}
