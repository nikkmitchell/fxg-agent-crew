import type { VaseEvent } from "../../shared/ikebana";

/**
 * Changes to the ikebana vase, as they arrive over the room socket
 * (shared/ikebana.ts).
 */
const listeners = new Set<(event: VaseEvent) => void>();

export function onVaseChange(listener: (event: VaseEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function vaseChanged(event: VaseEvent): void {
  for (const listener of listeners) listener(event);
}
