import { describe, expect, it } from "vitest";

/**
 * The room list's field is `roomName`.
 *
 * This test exists because I read `name`, found undefined on every room, and
 * shipped a Chat panel that told somebody standing in five rooms that they were
 * in none. The shape comes from WebHarness and saha.ing passes it through
 * unchanged, so it is not ours to rename — it is ours to read correctly.
 */
const pickRoom = (list: { roomName?: string }[], preferred: string): string | null => {
  const names = list.map((entry) => entry.roomName).filter(Boolean) as string[];
  return names.find((name) => name === preferred) ?? names[0] ?? null;
};

describe("choosing which room the chat panel shows", () => {
  const rooms = [
    { roomId: 3, roomName: "AgentParty" },
    { roomId: 16, roomName: "saha.ing" },
  ];

  it("prefers the room asked for", () => {
    expect(pickRoom(rooms, "saha.ing")).toBe("saha.ing");
  });

  it("falls back to whichever room they are actually in", () => {
    expect(pickRoom(rooms, "nowhere")).toBe("AgentParty");
  });

  it("says nothing rather than guessing when there are no rooms", () => {
    expect(pickRoom([], "saha.ing")).toBeNull();
  });

  it("does not accept a list of objects with a `name` field", () => {
    // The exact shipped bug: reading the wrong field yields undefined for every
    // entry, and `filter(Boolean)` then makes an empty list look like an empty
    // membership.
    expect(pickRoom([{ name: "saha.ing" } as { roomName?: string }], "saha.ing")).toBeNull();
  });
});
