import { useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import type { WirePerson } from "../../shared/space-wire";
import { arcPlacement } from "../../shared/space-layout";
import { arrivalSpot, boardFootprint, type Point, type Segment } from "../../shared/arrival";
import { SIGN_AT } from "./RoomGuideSign";

/**
 * NOT ON TOP OF ANYONE OR ANYTHING WHEN YOU ARRIVE (Nikk, 2026-09-28; see
 * shared/arrival.ts). A person's position is their own device's word, so the
 * nudge happens here: once per arrival, as soon as the room has said who is in
 * it (or after a short wait for an empty room), and only if where you landed
 * is within a metre of a person, an agent or a board. After that it never
 * moves you again.
 */
export function useArrivalClearance({
  peopleRef,
  you,
  arrivalKey,
  boards,
  where,
  move,
}: {
  peopleRef: RefObject<WirePerson[] | null>;
  you: string | null;
  /** Changes when you arrive somewhere new (a room), so each arrival is checked once. */
  arrivalKey: string;
  boards: () => Segment[];
  /** Where you are standing now, on the floor; null while not yet known. */
  where: () => Point | null;
  /** Shift yourself by this much. */
  move: (dx: number, dz: number) => void;
}): void {
  const state = useRef<{ key: string; since: number; done: boolean } | null>(null);
  useFrame(() => {
    const now = performance.now();
    if (!state.current || state.current.key !== arrivalKey) state.current = { key: arrivalKey, since: now, done: false };
    const arrival = state.current;
    if (arrival.done) return;
    const others = othersIn(peopleRef.current, you);
    const waited = now - arrival.since;
    // A moment for the first snapshot; longer only if the room looks empty.
    if (waited < 400 || (others.length === 0 && waited < 2500)) return;
    arrival.done = true;
    const here = where();
    if (!here) return;
    const spot = arrivalSpot(here, others, boards());
    if (spot.x !== here.x || spot.z !== here.z) move(spot.x - here.x, spot.z - here.z);
  });
}

/** Everyone drawn in the room but you: connected people, and agents (drawn even while dozing). */
export function othersIn(people: readonly WirePerson[] | null, you: string | null): Point[] {
  const me = you?.toLowerCase() ?? null;
  return (people ?? [])
    .filter((person) => person.actorId.toLowerCase() !== me && (person.connected || person.kind === "agent"))
    .map((person) => ({ x: person.at.x, z: person.at.z }));
}

/** The boards standing in a room: the open work panels (none in the lobby), and the meditation guide board. */
export function roomBoards(openPanels: readonly string[], inLobby: boolean, meditationShown: boolean): Segment[] {
  const boards: Segment[] = [];
  if (!inLobby) {
    openPanels.forEach((_, index) => {
      const surface = arcPlacement(index, openPanels.length).surface;
      boards.push(boardFootprint(surface.position, surface.width, surface.rotationY));
    });
  }
  if (meditationShown) boards.push(boardFootprint({ x: SIGN_AT[0], z: SIGN_AT[2] }, 1.5, 0.95));
  return boards;
}
