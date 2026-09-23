import { describe, expect, it } from "vitest";
import { resolveJoinedRoom } from "./useRoomFeed";

describe("room feed selection", () => {
  const joined = [
    { roomName: "makers", ownerName: "Alice", visibility: "public" as const },
    { roomName: "saha.ing", ownerName: "Nikk", visibility: "public" as const },
  ];

  it("uses an explicit room only when membership confirms it", () => {
    expect(resolveJoinedRoom(joined, "makers", "saha.ing")).toBe("makers");
    expect(resolveJoinedRoom(joined, "old-private-room", "saha.ing")).toBeNull();
  });

  it("chooses a joined default and keeps it stable across a list refresh", () => {
    expect(resolveJoinedRoom(joined, null, "saha.ing")).toBe("saha.ing");
    expect(resolveJoinedRoom([...joined], null, "saha.ing")).toBe("saha.ing");
    expect(resolveJoinedRoom(joined, null, "unknown")).toBe("makers");
  });
});
