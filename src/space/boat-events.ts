import type { Boat } from "../../shared/boats";

/** Boats released, as they arrive over the room socket. */
const listeners = new Set<(boat: Boat) => void>();

export function onBoat(listener: (boat: Boat) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function boatLaunched(boat: Boat): void {
  for (const listener of listeners) listener(boat);
}
