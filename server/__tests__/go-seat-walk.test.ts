import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../db/open.js";
import { AGENT_AT_PANEL_MS, ATTENTION_MS, Activity } from "../space/activity.js";
import { GO_SEAT_MS, destinationFor, goTableEntity, goTableEntityId, restingPlace } from "../space/destinations.js";
import { RoomItems } from "../space/items.js";
import { Presence } from "../space/presence.js";
import { goSeat } from "../../shared/go-layout.js";
import { buildServer } from "../index.js";

/**
 * AN AGENT PLAYING GO THROUGH CODE WALKS TO ITS SEAT.
 *
 * Lumenfold asked every agent whether it could "move beside a human at the Go
 * table". None could: a move through tools/go.mts wrote no audit row, and the
 * walker only knew panels, so an agent played from its desk and nobody in the
 * room could see who was playing. Rows here are written by the real
 * RoomItems.recordPlay and the real `play` route, not made by hand.
 */

const ROOM = "saha.ing";

const boot = () => {
  const db = openDatabase(":memory:", DatabaseSync);
  const items = new RoomItems(db);
  const presence = new Presence();
  let clock = 1_000_000;
  const activity = new Activity(db, presence, () => clock, () => ({}), () => null, (id) => items.one(ROOM, id));
  activity.catchUp();
  return { db, items, presence, activity, tick: (ms: number) => { clock += ms; }, now: () => clock };
};

describe("an agent's Go move walks it to the table", () => {
  it("to its own seat, facing the board, saying why", () => {
    const { items, presence, activity } = boot();
    const table = items.add(ROOM, "Moraine");
    items.recordPlay("Inkstone", table.id, 1, { x: 3, y: 3 });
    expect(activity.step()).toBe(1);
    const seat = goSeat(table, 1);
    const inkstone = presence.find("Inkstone");
    expect(inkstone?.heading).toEqual(seat.at);
    expect(inkstone?.because).toBe("is playing Go");
    // The sentence says what they are doing, never the move.
    expect(inkstone?.because).not.toMatch(/D4|3/);
  });

  it("to where the table is NOW, after somebody moved it", () => {
    const { items, presence, activity } = boot();
    const table = items.add(ROOM, "Moraine");
    table.position = { x: 4, y: 0, z: -2, rotationY: 1.1 };
    items.save(ROOM, table, "Moraine");
    items.recordPlay("Inkstone", table.id, 0, { x: 1, y: 1 });
    activity.step();
    expect(presence.find("Inkstone")?.heading).toEqual(goSeat(table, 0).at);
  });

  it("nowhere, rather than somewhere invented, for a table or seat that is gone", () => {
    const { items } = boot();
    const table = items.add(ROOM, "Moraine");
    const row = (entityId: string) => ({ id: 1, actorId: "Inkstone", action: "play", entity: "go_table", entityId });
    const lookup = (id: string) => items.one(ROOM, id);
    expect(destinationFor(row(goTableEntityId("no-such-table", 0)), {}, () => null, lookup)).toBeNull();
    expect(destinationFor(row(goTableEntityId(table.id, 5)), {}, () => null, lookup)).toBeNull(); // two seats only
    expect(destinationFor(row(table.id), {}, () => null, lookup)).toBeNull(); // no colour
    expect(destinationFor(row(goTableEntityId(table.id, 1)), {}, () => null, lookup)?.because).toBe("is playing Go");
  });

  it("reads the table and colour back out of a table id that has slashes of its own", () => {
    expect(goTableEntity(goTableEntityId("a/b", 3))).toEqual({ table: "a/b", colour: 3 });
    expect(goTableEntity("plain")).toEqual({ table: null, colour: null });
  });
});

describe("staying for the game, not for a move", () => {
  it("stays at the seat between moves — past a panel's few seconds and past the attention window", () => {
    const { items, presence, activity, tick } = boot();
    const table = items.add(ROOM, "Moraine");
    items.recordPlay("Inkstone", table.id, 0, { x: 4, y: 4 });
    activity.step();
    const seat = goSeat(table, 0).at;
    for (const wait of [AGENT_AT_PANEL_MS + 1_000, ATTENTION_MS]) {
      tick(wait);
      activity.step();
      expect(presence.find("Inkstone")?.heading, `after another ${wait} ms`).toEqual(seat);
    }
  });

  it("walks home once the game has stopped, and each move starts the stay again", () => {
    const { items, presence, activity, tick } = boot();
    const table = items.add(ROOM, "Moraine");
    items.recordPlay("Inkstone", table.id, 0, { x: 4, y: 4 });
    activity.step();
    tick(GO_SEAT_MS - 60_000);
    items.recordPlay("Inkstone", table.id, 0, { x: 5, y: 5 }); // another move, just in time
    activity.step();
    tick(GO_SEAT_MS - 60_000);
    activity.step();
    expect(presence.find("Inkstone")?.heading).toEqual(goSeat(table, 0).at);
    tick(120_000); // no move for a whole stay
    activity.step();
    expect(presence.find("Inkstone")?.heading).toEqual(restingPlace("Inkstone").at);
    expect(presence.find("Inkstone")?.because).toBeNull();
  });

  it("a restart mid-game puts the player back at its seat, not at its desk", () => {
    const { db, items, tick, now } = boot();
    // Only agents the room knows are rebuilt after a restart.
    db.prepare("INSERT INTO actors (id, kind, first_seen_at, updated_at) VALUES (?,?,?,?)")
      .run("Inkstone", "agent", new Date(now()).toISOString(), new Date(now()).toISOString());
    const table = items.add(ROOM, "Moraine");
    items.recordPlay("Inkstone", table.id, 1, { x: 2, y: 2 });
    db.prepare("UPDATE audit SET at = ? WHERE entity = 'go_table'").run(new Date(now()).toISOString());
    tick(3 * 60_000); // three minutes into the other player's think: far past a panel's stay
    const presence = new Presence();
    const rebuilt = new Activity(db, presence, now, () => ({}), () => null, (id) => items.one(ROOM, id));
    rebuilt.rehydrate();
    expect(presence.find("Inkstone")?.at).toEqual(goSeat(table, 1).at);
    expect(presence.find("Inkstone")?.because).toBe("is playing Go");
  });
});

describe("the play route writes the row the walker reads", () => {
  it("one row for an accepted move, none for a refused one", async () => {
    const { app, sessions, config, database } = buildServer({ WEBHARNESS_URL: "https://example.test", DATABASE_PATH: ":memory:", BLOB_ROOT: "/tmp/go-test-blobs", LOG_LEVEL: "silent" });
    try {
      const items = new RoomItems(database), item = items.add(ROOM, "Moraine");
      const cookie = `${config.cookieName}=${sessions.create("Inkstone", "t", "agent")}`;
      const action = (payload: object) => app.inject({ method: "POST", url: `/bff/space/items/${item.id}/action`, headers: { cookie }, payload });
      const rows = () => database.prepare("SELECT actor_id AS actorId, action, entity, entity_id AS entityId FROM audit WHERE entity = 'go_table'").all();

      expect((await action({ action: "play", x: 2, y: 2, colour: 1 })).statusCode).toBe(409); // not White's turn
      expect(rows()).toEqual([]);
      expect((await action({ action: "play", x: 2, y: 2, colour: 0 })).statusCode).toBe(200);
      expect(rows()).toEqual([{ actorId: "Inkstone", action: "play", entity: "go_table", entityId: goTableEntityId(item.id, 0) }]);
      // Lifting and placing by hand writes nothing: a person there is already there.
      expect((await action({ action: "lift", colour: 1 })).statusCode).toBe(200);
      expect((await action({ action: "place", x: 3, y: 3 })).statusCode).toBe(200);
      expect(rows()).toHaveLength(1);
    } finally { await app.close(); }
  });
});
