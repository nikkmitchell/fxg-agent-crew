import type { GardenEvent } from "../../shared/garden";

/**
 * Changes to the room's sand garden, as they arrive over the room socket
 * (shared/garden.ts). GardenTray applies them to what it holds.
 */
const listeners = new Set<(event: GardenEvent) => void>();

export function onGardenChange(listener: (event: GardenEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function gardenChanged(event: GardenEvent): void {
  for (const listener of listeners) listener(event);
}
