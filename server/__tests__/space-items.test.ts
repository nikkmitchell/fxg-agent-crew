import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { SpaceLive } from "../spaces/live.js";
import { SpaceStore } from "../spaces/store.js";
import { KIT_LIMITS, readClientMessage, type ServerMessage, type SpaceItem } from "../../shared/space-kit.js";

/** Items that follow a person from space to space (shared/space-kit.ts). */
const store = () => new SpaceStore(openDatabase(":memory:", DatabaseSync) as unknown as DatabaseSync);
const socket = () => {
  const got: ServerMessage[] = [];
  return { got, send: (text: string) => got.push(JSON.parse(text)), close: () => undefined, items: () => (got.filter((m) => m.t === "items").at(-1) as { items: SpaceItem[] } | undefined)?.items };
};
const holder = (username: string, space: string) => ({ username, body: null, space });

let live: SpaceLive | null = null;
afterEach(() => live?.stop());

describe("items that follow you", () => {
  it("an item given in one space is carried into the next, and every open space hears of it", () => {
    live = new SpaceLive(store(), () => null);
    const inShop = socket();
    const inGarden = socket();
    const shop = live.join("shop", inShop, holder("nikk", "shop"));
    live.join("garden", inGarden, holder("nikk", "garden"));
    expect(inShop.items()).toEqual([]);
    shop.receive(JSON.stringify({ t: "give", name: "Marimba mallet", url: "/s/xr.instruments/pieces/marimba.js", data: { color: "red" } }));
    expect(inShop.items()).toMatchObject([{ name: "Marimba mallet", from: "shop", url: "/s/xr.instruments/pieces/marimba.js", data: { color: "red" } }]);
    expect(inGarden.items()).toMatchObject([{ name: "Marimba mallet", from: "shop" }]);
    const later = socket();
    live.join("lobby", later, holder("nikk", "lobby"));
    expect(later.items()).toHaveLength(1);
  });

  it("only the space that gave an item can take it back", () => {
    live = new SpaceLive(store(), () => null);
    const inShop = socket();
    const inGarden = socket();
    const shop = live.join("shop", inShop, holder("nikk", "shop"));
    const garden = live.join("garden", inGarden, holder("nikk", "garden"));
    shop.receive(JSON.stringify({ t: "give", name: "Hat" }));
    const id = inShop.items()![0].id;
    garden.receive(JSON.stringify({ t: "drop", id }));
    expect(inGarden.got.at(-1)).toMatchObject({ t: "refused" });
    expect(inShop.items()).toHaveLength(1);
    shop.receive(JSON.stringify({ t: "drop", id }));
    expect(inShop.items()).toEqual([]);
  });

  it("guests carry nothing and cannot be given things; one person's items are theirs alone", () => {
    live = new SpaceLive(store(), () => null);
    const guest = socket();
    const other = socket();
    const watching = live.join("shop", guest, null);
    live.join("shop", other, holder("baiwei", "shop"));
    watching.receive(JSON.stringify({ t: "give", name: "Hat" }));
    expect(guest.items()).toBeUndefined();
    expect(other.items()).toEqual([]);
  });

  it("refuses items that point outside spaces or are too big", () => {
    expect(readClientMessage({ t: "give", name: "x", url: "https://evil.example/x.js" })).toBeNull();
    expect(readClientMessage({ t: "give", name: "x", url: "/s/a/../../bff/x" })).toBeNull();
    expect(readClientMessage({ t: "give", name: "x", data: "y".repeat(KIT_LIMITS.itemDataBytes + 10) })).toBeNull();
    expect(readClientMessage({ t: "give", name: "  " })).toBeNull();
    expect(readClientMessage({ t: "give", name: "Hat", url: "/s/shop/hat.glb" })).toEqual({ t: "give", name: "Hat", url: "/s/shop/hat.glb", data: null });
  });
});
