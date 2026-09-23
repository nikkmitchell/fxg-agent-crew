import { describe, expect, it } from "vitest";
import { resolveJoinedRoom } from "./useRoomFeed";

/**
 * Exercise the production selection rule: an explicit joined room wins, an
 * invalid deep link is not silently redirected, and a new visitor gets the
 * preferred room (or the first joined room).
 */
describe("choosing which room the chat panel shows", () => {
  const rooms = [
    { roomName: "AgentParty" },
    { roomName: "saha.ing" },
  ];

  it("uses an explicitly selected room when it is joined", () => {
    expect(resolveJoinedRoom(rooms, "saha.ing", "AgentParty")).toEqual({
      roomName: "AgentParty",
      invalidRequest: false,
    });
  });

  it("does not silently redirect an invalid room deep link", () => {
    expect(resolveJoinedRoom(rooms, "saha.ing", "nowhere")).toEqual({
      roomName: null,
      invalidRequest: true,
    });
  });

  it("prefers saha.ing for a new visitor when joined", () => {
    expect(resolveJoinedRoom(rooms, "saha.ing", null)).toEqual({
      roomName: "saha.ing",
      invalidRequest: false,
    });
  });

  it("falls back to the first joined room when the preferred room is absent", () => {
    expect(resolveJoinedRoom([rooms[0]], "saha.ing", null)).toEqual({
      roomName: "AgentParty",
      invalidRequest: false,
    });
  });

  it("returns no selection when there are no joined rooms", () => {
    expect(resolveJoinedRoom([], "saha.ing", null)).toEqual({
      roomName: null,
      invalidRequest: false,
    });
  });
});
