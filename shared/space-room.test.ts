import { describe, expect, it } from "vitest";
import { isLobby, LOBBY_ROOM } from "./space-room.js";

describe("the lobby", () => {
  it("is the lobby whatever its capitals or spaces, everywhere that asks", () => {
    // The avatar recorder asked `room === "lobby"` while Go Home asked it
    // without capitals; "Lobby" was the lobby for one and not the other.
    for (const name of ["lobby", "Lobby", " LOBBY "]) expect(isLobby(name), name).toBe(true);
    expect(isLobby("lobby2")).toBe(false);
    expect(isLobby(null)).toBe(false);
    expect(LOBBY_ROOM).toBe("lobby");
  });
});
