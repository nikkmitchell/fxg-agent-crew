import { describe, expect, it } from "vitest";
import type { RoomSummary } from "./contracts.js";
import { isLobby, lobbyDoors, pageOf, wearables } from "./lobby-hall.js";

/** The lobby as a front hall (Nikk, 2026-09-27). */
const room = (roomName: string, changes: Partial<RoomSummary> = {}): RoomSummary =>
  ({ roomName, ownerName: "", visibility: "public", ...changes });

describe("the lobby's doors", () => {
  it("is only the room called lobby, however it is spelled", () => {
    expect(isLobby("Lobby")).toBe(true);
    expect(isLobby(" lobby ")).toBe(true);
    expect(isLobby("saha.ing")).toBe(false);
    expect(isLobby(null)).toBe(false);
  });

  it("shows your rooms, private ones too, then every public room you are not in, each once", () => {
    const mine = [room("saha.ing"), room("secret club", { visibility: "private", ownerName: "Nikk2" }), room("lobby")];
    const open = [room("Saha.ing"), room("Go Club"), room("Art")];
    const doors = lobbyDoors(mine, open, "lobby");
    expect(doors.map((door) => [door.room, door.kind])).toEqual([
      ["lobby", "here"],
      ["saha.ing", "enter"],
      ["secret club", "enter"],
      ["Art", "join"],
      ["Go Club", "join"],
    ]);
    expect(doors[2].detail).toBe("private · Nikk2's");
    expect(doors[3].detail).toBe("public");
  });

  it("draws no doors until the lists arrive, rather than claiming you are in nothing", () => {
    expect(lobbyDoors(null, null, "lobby")).toEqual([]);
    expect(lobbyDoors([room("saha.ing")], null, "lobby").map((door) => door.room)).toEqual(["saha.ing"]);
  });
});

describe("pages", () => {
  it("cuts a list into pages and keeps the page in range", () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    expect(pageOf(items, 10, 0)).toEqual({ items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], page: 0, pages: 3 });
    expect(pageOf(items, 10, 2).items).toEqual([20, 21, 22]);
    expect(pageOf(items, 10, 9).page).toBe(2);
    expect(pageOf(items, 10, -4).page).toBe(0);
    expect(pageOf([], 10, 0)).toEqual({ items: [], page: 0, pages: 1 });
  });
});

describe("the wardrobe stand", () => {
  it("never offers a body taken off the list, even when the server has it (Nikk, 5244)", () => {
    expect(wearables(["coolpoo", "abissaldude"], [{ name: "CoolPoo" }, { name: "AbissalDude" }]).map((one) => one.key)).toEqual(["abissaldude"]);
  });

  it("offers only what this server can serve, by catalogue name, in name order", () => {
    const catalogue = [
      { name: "Zebra Man", thumbnail: "x" },
      { name: "AbissalDude", thumbnail: "x" },
      { name: "Gone Again", thumbnail: "x" },
    ];
    const onHand = [{ slug: "cool-fridge", catalogue: null }, { slug: "zebraman", catalogue: "Zebra Man" }];
    expect(wearables(["abissaldude", "zebraman", "coolfridge"], catalogue, onHand)).toEqual([
      { name: "AbissalDude", key: "abissaldude", pictured: true },
      { name: "cool-fridge", key: "coolfridge", pictured: false },
      { name: "Zebra Man", key: "zebraman", pictured: true },
    ]);
  });
});
