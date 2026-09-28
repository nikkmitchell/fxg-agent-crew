/** The sound bath starting or stopping, over the room socket. */
const listeners = new Set<(bath: { startedAt: number | null; by: string }) => void>();

export function onBath(listener: (bath: { startedAt: number | null; by: string }) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function bathChanged(bath: { startedAt: number | null; by: string }): void {
  for (const listener of listeners) listener(bath);
}
