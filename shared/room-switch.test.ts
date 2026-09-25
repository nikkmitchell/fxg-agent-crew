import { describe, expect, it } from "vitest";
import type { RoomSummary } from "./contracts.js";
import { roomMenuRows } from "./room-switch.js";

const room = (roomName: string, visibility: "public" | "private" = "public", ownerName = "Nikk2"): RoomSummary =>
  ({ roomName, visibility, ownerName });

describe("the Rooms page in the room's settings (Nikk 4735)", () => {
  it("lists your rooms with the one you are in first, marked, and inert", () => {
    const rows = roomMenuRows([room("saha.ing"), room("meditation.AR"), room("garden", "private")], [], "saha.ing");
    expect(rows[0]).toEqual({ kind: "heading", label: "Your rooms" });
    expect(rows[1]).toMatchObject({ kind: "here", room: "saha.ing" });
    expect(rows.slice(2).map((row) => row.kind === "switch" && row.room)).toEqual(["garden", "meditation.AR"]);
    expect(rows.find((row) => "room" in row && row.room === "garden")?.label).toContain("private");
  });

  it("matches the room you are in whatever its capitals", () => {
    const rows = roomMenuRows([room("Meditation.AR")], [], "meditation.ar");
    expect(rows[1]).toMatchObject({ kind: "here" });
  });

  it("offers public rooms you have not joined, one tap to join and go, and never ones you have", () => {
    const rows = roomMenuRows([room("saha.ing")], [room("saha.ing"), room("lobby"), room("aura.hack")], "saha.ing");
    const joins = rows.filter((row) => row.kind === "join").map((row) => row.kind === "join" && row.room);
    expect(joins).toEqual(["aura.hack", "lobby"]);
    expect(rows).toContainEqual({ kind: "heading", label: "Public rooms to join" });
  });

  it("says so while the lists load, and when there is nothing yet", () => {
    expect(roomMenuRows(null, null, null)).toContainEqual({ kind: "note", label: "Finding your rooms…" });
    expect(roomMenuRows([], [], null)).toContainEqual({ kind: "note", label: "You are not in any room yet" });
    expect(roomMenuRows([room("a")], [], null).some((row) => row.kind === "here")).toBe(false);
  });
});
