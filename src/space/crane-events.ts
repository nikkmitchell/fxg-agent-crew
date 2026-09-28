import type { CraneEvent } from "../../shared/cranes";

/**
 * Changes to the paper cranes, as they arrive over the room socket
 * (shared/cranes.ts).
 */
const listeners = new Set<(event: CraneEvent) => void>();

export function onCranesChange(listener: (event: CraneEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function cranesChanged(event: CraneEvent): void {
  for (const listener of listeners) listener(event);
}
