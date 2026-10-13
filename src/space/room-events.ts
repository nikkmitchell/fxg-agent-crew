import { useEffect, useRef } from "react";
import type { Boat } from "../../shared/boats";
import type { CairnEvent } from "../../shared/cairn";
import type { CraneEvent } from "../../shared/cranes";
import type { Drift } from "../../shared/driftwood";
import type { Offering } from "../../shared/fire";
import type { GardenEvent } from "../../shared/garden";
import type { Hourglass } from "../../shared/hourglass";
import type { VaseEvent } from "../../shared/ikebana";
import type { Stick } from "../../shared/incense";
import type { Lantern } from "../../shared/lantern";
import type { MandalaEvent } from "../../shared/mandala";
import type { PiecesEvent } from "../../shared/room-pieces";
import type { StarEvent } from "../../shared/stars";
import type { WheelPush } from "../../shared/wheel";
import type { ServerMessage } from "../../shared/space-wire";

/**
 * WHAT THE ROOM SOCKET TELLS EACH OBJECT IN THE ROOM, and who is listening.
 *
 * There were fifteen files of this (cairn-events.ts, vase-events.ts, ...), each
 * the same fifteen lines with a different type, and an `if` per object in
 * useSpaceSocket to call the right one (Nikk, 2026-10-14: "it seems like we
 * have multiple systems for different things"). One channel, made fifteen
 * times, under the names every component already imports; and one place that
 * says which socket message goes where.
 */
function channel<E>() {
  const listeners = new Set<(event: E) => void>();
  const on = (listener: (event: E) => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const emit = (event: E): void => {
    for (const listener of [...listeners]) listener(event);
  };
  return [on, emit] as const;
}

export const [onBoat, boatLaunched] = channel<Boat>();
export const [onBath, bathChanged] = channel<{ startedAt: number | null; by: string }>();
export const [onCairnChange, cairnChanged] = channel<CairnEvent>();
export const [onCranesChange, cranesChanged] = channel<CraneEvent>();
export const [onDrift, drifted] = channel<Drift>();
export const [onOffering, offered] = channel<Offering>();
export const [onGardenChange, gardenChanged] = channel<GardenEvent>();
export const [onHourglass, hourglassTurned] = channel<Hourglass>();
export const [onIncense, incenseLit] = channel<Stick[]>();
export const [onLantern, lanternReleased] = channel<Lantern>();
export const [onMandalaChange, mandalaChanged] = channel<MandalaEvent>();
export const [onPiecesChange, piecesChanged] = channel<PiecesEvent>();
export const [onStarChange, starsChanged] = channel<StarEvent>();
export const [onVaseChange, vaseChanged] = channel<VaseEvent>();
export const [onWheelPush, wheelPushed] = channel<WheelPush>();

/**
 * THE ROOM SAID WELCOME: its socket opened, opened again after a drop or a
 * deploy, or opened in another room (a door, the room menu). Each object read
 * what it shows once, when it first appeared, so a stone laid during a drop,
 * or the whole of the room you had just walked into, never reached it: after
 * an in-place switch between two rooms with gardens, the cairn, the vase and the
 * garden went on showing the room you had left, with the new room's changes
 * applied on top (Kerf, 2026-10-14). useSpaceSocket says welcome; every object
 * reads again (useRoomRead). The guide board's pieces already did, their own way.
 */
export const [onRoomWelcome, roomWelcomed] = channel<void>();

/** Read what this object shows now, and again whenever the room says welcome. `read` replaces it whole. */
export function useRoomRead(read: () => void): void {
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    const again = () => latest.current();
    again();
    return onRoomWelcome(again);
  }, []);
}

type RoomEventType = "pieces" | "cranes" | "cairn" | "boat" | "hourglass" | "bath" | "vase" | "incense" | "stars"
  | "lantern" | "wheel" | "mandala" | "driftwood" | "fire" | "garden";

/**
 * Hand one socket message to the object it is about. True when it was one of
 * these; false for anything else, which the socket deals with itself (and, as
 * a type guard, knows is not one of these).
 */
export function deliverRoomEvent(message: ServerMessage): message is Extract<ServerMessage, { type: RoomEventType }> {
  switch (message.type) {
    case "pieces": piecesChanged(message.event); return true;
    case "cranes": cranesChanged(message.event); return true;
    case "cairn": cairnChanged(message.event); return true;
    case "boat": boatLaunched(message.boat); return true;
    case "hourglass": hourglassTurned(message.glass); return true;
    case "bath": bathChanged(message.bath); return true;
    case "vase": vaseChanged(message.event); return true;
    case "incense": incenseLit(message.sticks); return true;
    case "stars": starsChanged(message.event); return true;
    case "lantern": lanternReleased(message.lantern); return true;
    case "wheel": wheelPushed(message.push); return true;
    case "mandala": mandalaChanged(message.event); return true;
    // A word on driftwood: Shore.tsx floats it out.
    case "driftwood": drifted(message.drift); return true;
    // A word for the ember fire: EmberFire.tsx burns it.
    case "fire": offered(message.offering); return true;
    // The sand garden changed: GardenTray.tsx applies it.
    case "garden": gardenChanged(message.event); return true;
    default: return false;
  }
}
