import { describe, expect, it } from "vitest";
import { preferredRoomToOpen, retryDelay } from "./use-webharness-room";

describe("room reconnect backoff", () => {
  it("backs off exponentially and caps at fifteen seconds", () => {
    expect([1, 2, 3, 4, 5, 6].map(retryDelay)).toEqual([1_000, 2_000, 4_000, 8_000, 15_000, 15_000]);
  });
});

describe("opening the selected lobby room in the composer", () => {
  const rooms = [{ roomName: "saha.ing" }, { roomName: "makers" }];

  it("opens only a confirmed joined room", () => {
    expect(preferredRoomToOpen("makers", null, "selecting_room", rooms, false)).toBe("makers");
    expect(preferredRoomToOpen("private", null, "selecting_room", rooms, false)).toBeNull();
    expect(preferredRoomToOpen("makers", null, "loading_rooms", rooms, false)).toBeNull();
  });

  it("does not move a pending send to another room or override a manual choice", () => {
    expect(preferredRoomToOpen("makers", null, "connected", rooms, true)).toBeNull();
    expect(preferredRoomToOpen("makers", "makers", "connected", rooms, false)).toBeNull();
    expect(preferredRoomToOpen("saha.ing", "makers", "connected", rooms, false)).toBe("saha.ing");
  });
});
