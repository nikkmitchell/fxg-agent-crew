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
  it("changes the board type mid-game, with a stone in the air, keeping everything else", async () => {
    // Nikk: "can we allow for changing board types inside the settings".
    // Only the look changes, so nothing about the game is refused or lost.
    const { app, sessions, config, database } = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: "/tmp/go-test-blobs", LOG_LEVEL: "silent" });
    try {
      const items = new RoomItems(database), item = items.add("saha.ing", "Moraine");
      expect(item.surface).toBe("bamboo");
      item.stones = [{ id: "played", x: 4, y: 4, colour: 0 }];
      item.liftedColour = 1; item.carrier = { by: "Moraine", hand: "left" };
      items.save("saha.ing", item, "Moraine");
      const cookie = `${config.cookieName}=${sessions.create("Moraine", "t", "agent")}`;
      const patch = (payload: object) => app.inject({ method: "PATCH", url: `/bff/space/items/${item.id}`, headers: { cookie }, payload });
      const refused = await patch({ surface: "marble" });
      expect(refused.statusCode).toBe(400);
      expect(refused.json().error).toMatch(/bamboo, stone/);
      const stone = await patch({ surface: "stone", revision: 0 });
      expect(stone.statusCode).toBe(200);
      expect(stone.json().item).toEqual({ ...item, surface: "stone", revision: 1 });
      expect(items.one("saha.ing", item.id)).toEqual(stone.json().item);
      expect((await patch({ surface: "bamboo", revision: 0 })).statusCode).toBe(409);
    } finally { await app.close(); }
  });

  it("plays a whole move in one request for code — only on that colour's turn, never over a stone in the air", async () => {
    // Nikk: "a way for agents to read the board through code and place their
    // pieces through code". Lift-then-place leaves a stone hanging if a
    // program dies between them; `play` cannot.
    const { app, sessions, config, database } = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: "/tmp/go-test-blobs", LOG_LEVEL: "silent" });
    try {
      const items = new RoomItems(database), item = items.add("saha.ing", "Moraine");
      const agent = `${config.cookieName}=${sessions.create("Sill", "t", "agent")}`;
      const person = `${config.cookieName}=${sessions.create("baiwei2", "t", "human")}`;
      const action = (cookie: string, payload: object) => app.inject({ method: "POST", url: `/bff/space/items/${item.id}/action`, headers: { cookie }, payload });

      expect((await action(agent, { action: "play", x: 2, y: 2 })).statusCode).toBe(400); // no colour named
      const early = await action(agent, { action: "play", x: 2, y: 2, colour: 1 });
      expect(early.statusCode).toBe(409);
      expect(early.json().code).toBe("NOT_YOUR_TURN");

      const played = await action(agent, { action: "play", x: 2, y: 2, colour: 0, revision: 0 });
      expect(played.statusCode).toBe(200);
      expect(played.json().item).toMatchObject({ activeColour: 1, liftedColour: null, carrier: null, revision: 1 });
      expect(played.json().item.stones).toEqual([expect.objectContaining({ x: 2, y: 2, colour: 0 })]);
      expect(items.one("saha.ing", item.id)?.stones).toHaveLength(1);

      // A stale revision is refused like every other change.
      expect((await action(agent, { action: "play", x: 3, y: 3, colour: 1, revision: 0 })).statusCode).toBe(409);
      // Occupied, and off the board.
      expect((await action(agent, { action: "play", x: 2, y: 2, colour: 1 })).json().error).toMatch(/occupied/i);
      expect((await action(agent, { action: "play", x: 9, y: 0, colour: 1 })).statusCode).toBe(400);

      // Somebody in a headset has White's stone in their hand: code waits.
      expect((await action(person, { action: "lift", hand: "right", colour: 1 })).statusCode).toBe(200);
      const busy = await action(agent, { action: "play", x: 3, y: 3, colour: 1 });
      expect(busy.statusCode).toBe(409);
      expect(busy.json().error).toMatch(/baiwei2 is carrying/);
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

/**
 * Nikk (4452): "we need to adjust it so that you can delete a go board, so in
 * settings there should also be a button for delete this board".
 */
describe("deleting a table", () => {
  const boot = () => {
    const built = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: "/tmp/go-test-blobs", LOG_LEVEL: "silent" });
    const cookie = (name: string) => `${built.config.cookieName}=${built.sessions.create(name, "t", "human")}`;
    const remove = (who: string, id: string) =>
      built.app.inject({ method: "DELETE", url: `/bff/space/items/${id}`, headers: { cookie: cookie(who) } });
    return { ...built, cookie, remove, items: new RoomItems(built.database) };
  };

  it("takes the table out of the room and answers with what is left", async () => {
    const { app, items, remove } = boot();
    try {
      const doomed = items.add("saha.ing", "Nikk2");
      const kept = items.add("saha.ing", "Nikk2");
      const response = await remove("Nikk2", doomed.id);
      expect(response.statusCode).toBe(200);
      expect(response.json().items.map((item: { id: string }) => item.id)).toEqual([kept.id]);
      expect(items.one("saha.ing", doomed.id)).toBeNull();
    } finally { await app.close(); }
  });

  it("says so for a table that is not there", async () => {
    const { app, remove } = boot();
    try {
      expect((await remove("Nikk2", "no-such-table")).statusCode).toBe(404);
    } finally { await app.close(); }
  });

  it("cannot reach a table in another room", async () => {
    const { app, items, remove } = boot();
    try {
      const elsewhere = items.add("lobby", "Sill");
      expect((await remove("Nikk2", elsewhere.id)).statusCode).toBe(404);
      expect(items.one("lobby", elsewhere.id)).not.toBeNull();
    } finally { await app.close(); }
  });

  /** A table vanishing out of somebody's hands is what the grab lock exists to prevent. */
  it("will not delete a table somebody else is carrying", async () => {
    const { app, items, remove, cookie } = boot();
    try {
      const table = items.add("saha.ing", "Nikk2");
      await app.inject({ method: "POST", url: "/bff/space/holds", headers: { cookie: cookie("baiwei2") }, payload: { thing: `item:${table.id}`, held: true } });
      const refused = await remove("Nikk2", table.id);
      expect(refused.statusCode).toBe(409);
      expect(refused.json()).toMatchObject({ code: "HELD", heldBy: "baiwei2" });
      expect(items.one("saha.ing", table.id)).not.toBeNull();
    } finally { await app.close(); }
  });
});
