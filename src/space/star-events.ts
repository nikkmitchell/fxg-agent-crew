import type { StarEvent } from "../../shared/stars";

/**
 * Changes to the star map, as they arrive over the room socket
 * (shared/stars.ts).
 */
const listeners = new Set<(event: StarEvent) => void>();

export function onStarChange(listener: (event: StarEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function starsChanged(event: StarEvent): void {
  for (const listener of listeners) listener(event);
}
