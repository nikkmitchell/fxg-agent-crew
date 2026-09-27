import type { Offering } from "../../shared/fire";

/** Words given to the ember fire, as they arrive over the room socket. Not kept. */
const listeners = new Set<(offering: Offering) => void>();

export function onOffering(listener: (offering: Offering) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function offered(offering: Offering): void {
  for (const listener of listeners) listener(offering);
}
