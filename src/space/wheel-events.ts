import type { WheelPush } from "../../shared/wheel";

/** Pushes of the prayer wheel, as they arrive over the room socket. */
const listeners = new Set<(push: WheelPush) => void>();

export function onWheelPush(listener: (push: WheelPush) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function wheelPushed(push: WheelPush): void {
  for (const listener of listeners) listener(push);
}
