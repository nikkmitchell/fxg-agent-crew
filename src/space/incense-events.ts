import type { Stick } from "../../shared/incense";

/** The incense bowl's sticks, whenever one is lit, over the room socket. */
const listeners = new Set<(sticks: Stick[]) => void>();

export function onIncense(listener: (sticks: Stick[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function incenseLit(sticks: Stick[]): void {
  for (const listener of listeners) listener(sticks);
}
