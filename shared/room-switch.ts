import type { RoomSummary } from "./contracts.js";
import { roomKey } from "./space-room.js";

/**
 * The ROOMS page in the room's own settings (Nikk, 4735): "I want to be able
 * to switch rooms directly inside of VR through settings ... a tab inside
 * settings that is rooms and I can switch to all the rooms I'm a part of, as
 * well as join a room".
 *
 * What the page lists and what each row does, decided here without a renderer
 * so it can be tested: the rooms you belong to first, the one you are in
 * marked and inert; then the public rooms you have not joined, each one tap to
 * join and go. Switching never leaves the headset: the room page enters the new
 * room and reconnects in place (SpacePanel's switchRoom).
 */
export type RoomMenuRow =
  | { kind: "heading"; label: string }
  | { kind: "here"; room: string; label: string }
  | { kind: "switch"; room: string; label: string }
  | { kind: "join"; room: string; label: string }
  | { kind: "note"; label: string };

const describe = (room: RoomSummary) =>
  `${room.roomName}${room.visibility === "private" ? " · private" : ""}${room.ownerName ? ` · ${room.ownerName}'s` : ""}`;

export function roomMenuRows(
  mine: readonly RoomSummary[] | null,
  publicRooms: readonly RoomSummary[] | null,
  current: string | null,
): RoomMenuRow[] {
  const rows: RoomMenuRow[] = [{ kind: "heading", label: "Your rooms" }];
  if (mine === null) rows.push({ kind: "note", label: "Finding your rooms…" });
  else if (mine.length === 0) rows.push({ kind: "note", label: "You are not in any room yet" });
  else {
    const here = current === null ? null : roomKey(current);
    const sorted = [...mine].sort((a, b) =>
      Number(roomKey(b.roomName) === here) - Number(roomKey(a.roomName) === here) || a.roomName.localeCompare(b.roomName));
    for (const room of sorted) {
      rows.push(roomKey(room.roomName) === here
        ? { kind: "here", room: room.roomName, label: `● ${describe(room)} — you are here` }
        : { kind: "switch", room: room.roomName, label: `Go to ${describe(room)}` });
    }
  }
  if (publicRooms === null) return rows;
  const joined = new Set((mine ?? []).map((room) => roomKey(room.roomName)));
  const open = publicRooms.filter((room) => !joined.has(roomKey(room.roomName)));
  if (open.length) {
    rows.push({ kind: "heading", label: "Public rooms to join" });
    for (const room of [...open].sort((a, b) => a.roomName.localeCompare(b.roomName))) {
      rows.push({ kind: "join", room: room.roomName, label: `Join and go to ${describe(room)}` });
    }
  }
  return rows;
}
