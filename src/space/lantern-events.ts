import type { Lantern } from "../../shared/lantern";

/** Lanterns released, as they arrive over the room socket. */
const listeners = new Set<(lantern: Lantern) => void>();

export function onLantern(listener: (lantern: Lantern) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function lanternReleased(lantern: Lantern): void {
  for (const listener of listeners) listener(lantern);
}
