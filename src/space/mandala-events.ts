import type { MandalaEvent } from "../../shared/mandala";

/**
 * Changes to the room's sand mandala, as they arrive over the room socket
 * (shared/mandala.ts). SandMandala applies them to what it holds.
 */
const listeners = new Set<(event: MandalaEvent) => void>();

export function onMandalaChange(listener: (event: MandalaEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function mandalaChanged(event: MandalaEvent): void {
  for (const listener of listeners) listener(event);
}
