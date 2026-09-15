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

/**
 * THE POINTER STARTS AT 70%. It was 10% for a quarter of an hour; Nikk, from the
 * headset: "can we make the... pointer brightness... if they don't set it, start
 * automatically at 70%".
 */
export const DEFAULT_ROOM_PREFERENCES: RoomPreferences = { rings: false, pointer: 0.7 };

/** One press of − or +. */
export const POINTER_STEP = 0.1;

/**
 * ONLY WHAT SOMEBODY CHOSE IS STORED, under a new name. The first version wrote
 * every field on any change, so turning the rings on also wrote down the 10%
 * pointer default as though it had been chosen — and moving the default to 70%
 * would not have reached that person. A default now stays a default until it is
 * actually changed. The rings choice from the first version is carried over.
 */
const KEY = "saha.room-preferences.v2";
const FIRST_KEY = "saha.room-preferences";

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

/** What somebody has actually chosen: the stored fields, and nothing filled in. */
function readChosen(): Partial<RoomPreferences> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Partial<RoomPreferences>;
    const first = window.localStorage.getItem(FIRST_KEY);
    const rings = first ? (JSON.parse(first) as { rings?: unknown }).rings : undefined;
    return typeof rings === "boolean" ? { rings } : {};
  } catch {
    return {};
  }
}

let chosen: Partial<RoomPreferences> | null = null;
let current: RoomPreferences | null = null;
const listeners = new Set<() => void>();

export function roomPreferences(): RoomPreferences {
  if (current) return current;
  if (typeof window === "undefined") return DEFAULT_ROOM_PREFERENCES;
  chosen = readChosen();
  current = parseRoomPreferences(chosen);
  return current;
}

export function setRoomPreferences(change: Partial<RoomPreferences>): void {
  roomPreferences();
  chosen = { ...chosen, ...change };
  current = parseRoomPreferences(chosen);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(chosen));
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
