import { describe, expect, it } from "vitest";
import { defaultGoItem, mergeRoomItems, withFresher, type RoomItem } from "./room-items.js";

const table = (id: string, revision: number, size = 9): RoomItem => ({ ...defaultGoItem(id), revision, size: size as 9 });

describe("a table's state on the client never goes backwards", () => {
  it("takes the answer to a change the moment it arrives", () => {
    const before = [table("a", 3)];
    const after = withFresher(before, table("a", 4, 13));
    expect(after[0].revision).toBe(4);
    expect(after[0].size).toBe(13);
  });

  it("ignores an answer older than what it already has", () => {
    const now = [table("a", 7)];
    expect(withFresher(now, table("a", 5))).toBe(now);
  });

  it("adds a table it did not know about", () => {
    expect(withFresher([table("a", 1)], table("b", 1)).map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("LETS A LATE BROADCAST NOT ROLL A TABLE BACK", () => {
    // The answer to our change (revision 5) arrived first; the socket then
    // delivers an older list (revision 4) that was already in flight.
    const applied = [table("a", 5, 13)];
    const merged = mergeRoomItems(applied, [table("a", 4, 9)]);
    expect(merged[0].revision).toBe(5);
    expect(merged[0].size).toBe(13);
  });

  it("still takes every newer table from a broadcast", () => {
    const merged = mergeRoomItems([table("a", 2)], [table("a", 3, 19)]);
    expect(merged[0]).toMatchObject({ revision: 3, size: 19 });
  });

  it("drops a table the server no longer has", () => {
    expect(mergeRoomItems([table("a", 1), table("b", 1)], [table("a", 1)]).map((t) => t.id)).toEqual(["a"]);
  });
});
