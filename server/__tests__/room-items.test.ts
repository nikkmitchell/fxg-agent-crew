import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../db/open.js";
import { RoomItems } from "../space/items.js";
import { buildServer } from "../index.js";

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

describe("Go actions", () => {
  it("hides only the desk, preserving the game, transform and flying stone", async () => {
    const { app, sessions, config, database } = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: "/tmp/go-test-blobs", LOG_LEVEL: "silent" });
    try {
      const items = new RoomItems(database), item = items.add("saha.ing", "Moraine");
      item.stones = [{ id: "played", x: 4, y: 4, colour: 0 }];
      item.captures = [{ id: "captured", x: 0, y: 0, colour: 1, by: 0 }];
      item.position = { x: 2, y: 0.3, z: -1, rotationY: 0.5 }; item.scale = 1.4;
      item.liftedColour = 0; item.carrier = { by: "Moraine", hand: "left" };
      items.save("saha.ing", item, "Moraine");
      const cookie = `${config.cookieName}=${sessions.create("Moraine", "t", "agent")}`;
      const patch = (payload: object) => app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie }, payload });
      expect((await patch({ deskVisible: "false" })).statusCode).toBe(400);
      const hidden = await patch({ deskVisible: false, revision: 0 });
      expect(hidden.statusCode).toBe(200);
      expect(hidden.json().item).toEqual({ ...item, deskVisible: false, revision: 1 });
      expect(items.one("saha.ing", item.id)).toEqual(hidden.json().item);
      expect((await patch({ deskVisible: true, revision: 0 })).statusCode).toBe(409);
      expect((await patch({ deskVisible: true, revision: 1 })).json().item).toEqual({ ...item, revision: 2 });
    } finally { await app.close(); }
  });
  it("serializes turns, protects a carrier, stores captures and retains an unchanged size", async () => {
    const { app, sessions, config, database } = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: "/tmp/go-test-blobs", LOG_LEVEL: "silent" });
    try {
      const items = new RoomItems(database), item = items.add("saha.ing", "Moraine");
      item.stones = [{ x: 0, y: 0, colour: 1, id: "captured" }, { x: 1, y: 0, colour: 0 }];
      items.save("saha.ing", item, "Moraine");
      const a = `${config.cookieName}=${sessions.create("Moraine", "t", "agent")}`;
      const b = `${config.cookieName}=${sessions.create("Sill", "t", "agent")}`;
      const action = (cookie: string, payload: object) => app.inject({ method: "POST", url: `/bff/space/items/${item.id}/action`, headers: { cookie }, payload });
      expect((await action(a, { action: "place", x: 0, y: 1 })).statusCode).toBe(409);
      expect((await action(a, { action: "lift", hand: "left", colour: 1 })).statusCode).toBe(409);
      expect((await action(a, { action: "lift", hand: "left", colour: 0, revision: 0 })).statusCode).toBe(200);
      const other = items.add("saha.ing", "Moraine");
      expect((await app.inject({ method: "POST", url: `/bff/space/items/${other.id}/action`, headers: { cookie: a }, payload: { action: "lift", hand: "left" } })).statusCode).toBe(409);
      expect((await action(b, { action: "lift" })).statusCode).toBe(409);
      expect((await app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie: a }, payload: { scale: 1.2 } })).statusCode).toBe(409);
      expect((await action(b, { action: "place", x: 0, y: 1 })).statusCode).toBe(409);
      expect((await action(a, { action: "place", x: 0, y: 1, revision: 0 })).statusCode).toBe(409);
      const moved = await action(a, { action: "place", x: 0, y: 1, revision: 1 });
      expect(moved.statusCode).toBe(200);
      expect(moved.json().item).toMatchObject({ activeColour: 1, liftedColour: null, carrier: null, revision: 2, captures: [{ id: "captured", x: 0, y: 0, colour: 1, by: 0 }] });
      const same = await app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie: b }, payload: { size: 9 } });
      expect(same.json().item.stones).toHaveLength(2);
      expect(same.json().item.captures).toHaveLength(1);
      expect(items.one("saha.ing", item.id)?.captures).toHaveLength(1);
      const position = { x: 2, y: 0.3, z: -1, rotationY: 0.5 };
      const transformed = await app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie: b }, payload: { position, scale: 1.4, revision: 3 } });
      expect(transformed.statusCode).toBe(200);
      expect(transformed.json().item).toMatchObject({ position, scale: 1.4, activeColour: 1, captures: [{ by: 0 }] });
      expect(items.one("saha.ing", item.id)?.stones).toHaveLength(2);
      for (const invalid of [{ scale: 0 }, { scale: 4 }, { position: {} }, { position: { ...position, y: -2 } }, { position: { ...position, x: "2" } }]) {
        expect((await app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie: b }, payload: invalid })).statusCode).toBe(400);
      }
      expect(items.one("saha.ing", item.id)?.position).toEqual(position);
      const reset = await app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie: b }, payload: { size: 5 } });
      expect(reset.json().item).toMatchObject({ stones: [], captures: [], activeColour: 0, carrier: null });
    } finally { await app.close(); }
  });
});
