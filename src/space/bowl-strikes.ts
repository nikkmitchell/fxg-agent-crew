import type { BowlStrike } from "../../shared/bowl";

/**
 * Strikes of the room's singing bowl, as they arrive over the room socket.
 * An event, not state: whoever is listening rings; nothing is kept.
 */
const listeners = new Set<(strike: BowlStrike) => void>();

export function onBowlStruck(listener: (strike: BowlStrike) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bowlStruck(strike: BowlStrike): void {
  for (const listener of listeners) listener(strike);
}
