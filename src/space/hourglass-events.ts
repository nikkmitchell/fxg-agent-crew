import type { Hourglass } from "../../shared/hourglass";

/** The hourglass being turned, over the room socket. */
const listeners = new Set<(glass: Hourglass) => void>();

export function onHourglass(listener: (glass: Hourglass) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function hourglassTurned(glass: Hourglass): void {
  for (const listener of listeners) listener(glass);
}
