import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { RoomItems } from "../space/items.js";

describe("room items", () => {
  it("keeps tables, turns, and stones inside their own room", () => {
    const db = openDatabase(":memory:", DatabaseSync);
    const items = new RoomItems(db);
    const saha = items.add("saha.ing", "Moraine");
    const lobby = items.add("lobby", "Sill");

    saha.liftedColour = 0;
    saha.stones.push({ x: 4, y: 4, colour: 0 });
    saha.activeColour = 1;
    items.save("saha.ing", saha, "Moraine");

    expect(items.all("saha.ing")).toEqual([saha]);
    expect(items.all("lobby")).toEqual([lobby]);
    expect(items.one("lobby", saha.id)).toBeNull();
    db.close();
  });
});
