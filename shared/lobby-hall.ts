import type { RoomSummary } from "./contracts.js";
import { roomKey } from "./space-room.js";
import { WITHDRAWN_BODIES, bodyKey } from "./avatar-choice.js";

/**
 * THE LOBBY IS A FRONT HALL, NOT A WORKROOM.
 *
 * Nikk (2026-09-27): "the lobby shouldn't have like boards and things ...
 * instead the lobby should have like a kind of doors with the rooms that you're
 * currently added to ... all public rooms show up there automatically ... as
 * well as any private rooms that you happen to be in ... a big panel that
 * contains all the rooms ... and you can join them. Where you can see your own
 * avatar. A selection to switch avatar that are available on the server."
 *
 * So in the room called `lobby` the work panels are not drawn; one panel of
 * doors, your own figure on show and a wardrobe stand in their place
 * (src/space/LobbyHall.tsx). What goes on them is decided here, where it is
 * tested.
 */
export const LOBBY_ROOM = "lobby";

export const isLobby = (room: string | null | undefined): boolean =>
  typeof room === "string" && roomKey(room) === LOBBY_ROOM;

/** One door: a room you are in (enter), are standing in (here), or could join. */
export type LobbyDoor = {
  room: string;
  kind: "here" | "enter" | "join";
  /** A short second line: whose it is, or that it is private. */
  detail: string;
};

/**
 * Every room you belong to, then every public room you do not, each once.
 * The one you are standing in comes first and is marked; the rest are in name
 * order, so a door stays where you last saw it. Null lists are "not loaded
 * yet" and give no doors rather than a wrong "you are in nothing".
 */
export function lobbyDoors(
  mine: readonly RoomSummary[] | null,
  publicRooms: readonly RoomSummary[] | null,
  current: string | null,
): LobbyDoor[] {
  const here = current === null ? null : roomKey(current);
  const detail = (room: RoomSummary) =>
    [room.visibility === "private" ? "private" : "", room.ownerName ? `${room.ownerName}'s` : ""].filter(Boolean).join(" · ");
  const doors: LobbyDoor[] = [];
  const seen = new Set<string>();
  const byName = (a: RoomSummary, b: RoomSummary) => a.roomName.localeCompare(b.roomName);
  for (const room of [...(mine ?? [])].sort((a, b) =>
    Number(roomKey(b.roomName) === here) - Number(roomKey(a.roomName) === here) || byName(a, b))) {
    const key = roomKey(room.roomName);
    if (seen.has(key)) continue;
    seen.add(key);
    doors.push({ room: room.roomName, kind: key === here ? "here" : "enter", detail: detail(room) });
  }
  for (const room of [...(publicRooms ?? [])].sort(byName)) {
    const key = roomKey(room.roomName);
    if (seen.has(key)) continue;
    seen.add(key);
    doors.push({ room: room.roomName, kind: "join", detail: detail(room) || "public" });
  }
  return doors;
}

/** One page of a list, with the page clamped into range. */
export function pageOf<T>(items: readonly T[], perPage: number, page: number): { items: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / perPage));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { items: items.slice(at * perPage, (at + 1) * perPage), page: at, pages };
}

/** One avatar you could wear: its catalogue name, its key, and whether it has a picture. */
export type Wearable = { name: string; key: string; pictured: boolean };

/**
 * What the wardrobe stand offers: every body this server can serve now
 * (`ready`, from GET /bff/space/bodies), named as the catalogue names it, in
 * name order. A body the server cannot serve is not offered, because it could
 * not be drawn. On-hand bodies the catalogue does not list keep their slug.
 */
export function wearables(
  ready: readonly string[],
  catalogue: readonly { name: string; thumbnail?: string }[],
  onHand: readonly { slug: string; catalogue: string | null }[] = [],
): Wearable[] {
  const canServe = new Set(ready.map(bodyKey).filter((key) => !WITHDRAWN_BODIES.has(key)));
  const found = new Map<string, Wearable>();
  for (const body of catalogue) {
    const key = bodyKey(body.name);
    if (canServe.has(key) && !found.has(key)) found.set(key, { name: body.name, key, pictured: Boolean(body.thumbnail) });
  }
  for (const body of onHand) {
    const key = bodyKey(body.slug);
    if (canServe.has(key) && !found.has(key)) found.set(key, { name: body.catalogue ?? body.slug, key, pictured: false });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
