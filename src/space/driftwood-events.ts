import type { Drift } from "../../shared/driftwood";

/** Words written on driftwood, as they arrive over the room socket. Not kept. */
const listeners = new Set<(drift: Drift) => void>();

export function onDrift(listener: (drift: Drift) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function drifted(drift: Drift): void {
  for (const listener of listeners) listener(drift);
}
