/**
 * Hide the agents in a room, for you alone.
 *
 * Nikk (5299): "under This room, Show, I also want to be able to hide agents
 * ... if it's the meditation room and I just want to test meditating without
 * seeing the agents working". The agents stay in the room and keep working;
 * they are only not drawn, and only on this device, for this room. Nobody
 * else's view changes: a switch that made agents vanish for everyone would
 * surprise the next person to walk in.
 *
 * Remembered per room in this browser, so meditation.AR can stay quiet while
 * the work room shows everybody.
 */
import { useSyncExternalStore } from "react";

const STORAGE_KEY = "saha.agentsHidden";

function readRooms(): Set<string> {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(list) ? list.filter((room): room is string => typeof room === "string") : []);
  } catch {
    return new Set();
  }
}

function writeRooms(rooms: Set<string>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...rooms]));
  } catch {
    // Private windows and full storage: the switch still works for this visit.
  }
}

let rooms = readRooms();
let current: string | null = null;
const listeners = new Set<() => void>();
const tell = () => listeners.forEach((listener) => listener());

/** Whether agents are hidden in `room` on this device. */
export function agentsHiddenIn(room: string | null): boolean {
  return room !== null && rooms.has(room.toLowerCase());
}

/** Hide or show the agents in `room`, on this device. */
export function setAgentsHidden(room: string, hidden: boolean): void {
  const key = room.toLowerCase();
  const next = new Set(rooms);
  if (hidden) next.add(key);
  else next.delete(key);
  rooms = next;
  writeRooms(rooms);
  tell();
}

/** The room being looked at now, so the scene knows which choice applies. */
export function setCurrentRoomForAgents(room: string | null): void {
  if (room === current) return;
  current = room;
  tell();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Whether the agents are hidden in the room being looked at now. */
export function useAgentsHidden(): boolean {
  return useSyncExternalStore(subscribe, () => agentsHiddenIn(current), () => false);
}

/** For tests: start again. */
export function resetAgentsHidden(): void {
  rooms = new Set();
  current = null;
  tell();
}
