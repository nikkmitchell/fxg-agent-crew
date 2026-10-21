import { describe, expect, it } from "vitest";
import { defaultGoItem, mergeRoomItems, withFresher, type GoRoomItem } from "./room-items.js";

const table = (id: string, revision: number, size = 9): GoRoomItem => ({ ...defaultGoItem(id), revision, size: size as 9 });

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

it("merges game and placement revisions independently", async () => {
  const { defaultGameItem } = await import("./table-games");
  const base: import("./room-items").ModuleRoomItem = {id:"games",kind:"module",revision:4,source:{space:"saha.ing",branch:"main",entry:"chess"},name:"Chess",role:"item",view:"placed",position:{x:2,y:0,z:1,rotationY:0},scale:1,addedBy:"Alice",tableGames:{"":{...defaultGameItem("games","chess","Alice"),revision:2}}};
  const stalePlacement = {...base, revision:3, position:{...base.position,x:0}, tableGames:{"":{...base.tableGames![""],revision:5}}};
  const merged=mergeRoomItems([base],[stalePlacement]);
  expect(merged[0].position.x).toBe(2);expect(merged[0].tableGames![""].revision).toBe(5);
  const late=withFresher(merged,base);expect(late[0].tableGames![""].revision).toBe(5);
});

it("hands back the very item it had when a broadcast brings nothing newer, so nothing redraws", async () => {
  const { defaultGameItem } = await import("./table-games");
  const held: import("./room-items").ModuleRoomItem = {id:"games",kind:"module",revision:4,source:{space:"saha.ing",branch:"main",entry:"chess"},name:"Chess",role:"item",view:"placed",position:{x:2,y:0,z:1,rotationY:0},scale:1,addedBy:"Alice",tableGames:{"":{...defaultGameItem("games","chess","Alice"),revision:2}}};
  const now = [held];
  // The same item again, as a fresh object off the socket: same revisions.
  expect(withFresher(now, JSON.parse(JSON.stringify(held)))).toBe(now);
  expect(mergeRoomItems(now, [JSON.parse(JSON.stringify(held))])[0]).toBe(held);
  // A newer match is still taken, and a newer placement still wins.
  const moved = { ...held, tableGames: { "": { ...held.tableGames![""], revision: 3 } } };
  expect(withFresher(now, moved)[0].tableGames![""].revision).toBe(3);
  const carried = { ...held, revision: 5, position: { ...held.position, x: 7 } };
  expect(withFresher(now, carried)[0].position.x).toBe(7);
});
