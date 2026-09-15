import { useSyncExternalStore } from "react";

/**
 * How one person likes the room drawn for them.
 *
 * Nikk, from the headset:
 *   - "users and agents have a colored ring around them below them can we have
 *     an option to remove that colored ring and can we also have it
 *     automatically off when you start"
 *   - "that weird pointer that's like attached to my finger that tells where I'm
 *     pointing... an option to remove that and also to adjust its brightness...
 *     make the brightness to be let's say 10% of what it currently is and have a
 *     way to just do plus minus to make the brightness from 0% to 100%"
 *
 * THIS BROWSER ONLY, like the pinch-to-teleport switch: both are about what one
 * person sees, not about the room, and nobody else's rings should vanish
 * because somebody turned theirs off.
 *
 * A TINY STORE rather than React state, because the pointer is drawn by the XR
 * library every frame from a function it calls, far from any component — see
 * `pointerOpacity` in xr-store.ts. Components read it with `useRoomPreferences`.
 */

export type RoomPreferences = {
  /** The coloured ring on the floor under every person and agent. */
  rings: boolean;
  /** The pointer's brightness, 0 (gone) to 1 (as bright as it used to be). */
  pointer: number;
};

export const DEFAULT_ROOM_PREFERENCES: RoomPreferences = { rings: false, pointer: 0.1 };

/** One press of − or +. */
export const POINTER_STEP = 0.1;

const KEY = "saha.room-preferences";

/** Read a stored value defensively: anything missing or odd falls back to the default. */
export function parseRoomPreferences(raw: unknown): RoomPreferences {
  const stored = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    rings: typeof stored.rings === "boolean" ? stored.rings : DEFAULT_ROOM_PREFERENCES.rings,
    pointer:
      typeof stored.pointer === "number" && Number.isFinite(stored.pointer)
        ? clampPointer(stored.pointer)
        : DEFAULT_ROOM_PREFERENCES.pointer,
  };
}

/** Between 0 and 1, on a tenth, so repeated presses land on 30% rather than 30.000000000000004%. */
export function clampPointer(value: number): number {
  return Math.min(1, Math.max(0, Math.round(value * 10) / 10));
}

/** The brightness after pressing − (−1) or + (+1). */
export function stepPointer(value: number, direction: -1 | 1): number {
  return clampPointer(value + direction * POINTER_STEP);
}

/** How a brightness reads on a menu row. */
export function pointerLabel(value: number): string {
  return value <= 0 ? "off" : `${Math.round(value * 100)}%`;
}

function read(): RoomPreferences {
  try {
    const raw = window.localStorage.getItem(KEY);
    return parseRoomPreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return DEFAULT_ROOM_PREFERENCES;
  }
}

let current: RoomPreferences | null = null;
const listeners = new Set<() => void>();

export function roomPreferences(): RoomPreferences {
  current ??= typeof window === "undefined" ? DEFAULT_ROOM_PREFERENCES : read();
  return current;
}

export function setRoomPreferences(change: Partial<RoomPreferences>): void {
  current = parseRoomPreferences({ ...roomPreferences(), ...change });
  try {
    window.localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // A private window keeps the choice for this visit only.
  }
  for (const listener of listeners) listener();
}

export function subscribeRoomPreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRoomPreferences(): RoomPreferences {
  return useSyncExternalStore(subscribeRoomPreferences, roomPreferences, () => DEFAULT_ROOM_PREFERENCES);
}
