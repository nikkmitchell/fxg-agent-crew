import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "../db/schema.js";

/**
 * Migration 27 gives the space a room, and REBUILDS five tables to do it.
 *
 * TESTED BECAUSE IT MOVES ROWS PEOPLE MADE. SQLite cannot add a column to a
 * primary key, so five of these tables are created afresh, copied into, dropped
 * and renamed. On an empty database — which is every other test in this suite —
 * all of that is indistinguishable from doing nothing at all: the copies move
 * no rows and the assertions would pass just as well if the SELECTs were
 * nonsense. The only database where it does anything is the one with the
 * project's whole history in it, and there is exactly one of those.
 *
 * So each table is seeded at 26, migrated, and read back.
 */
const upTo = (db: DatabaseSync, id: number) => {
  for (const migration of MIGRATIONS) {
    if (migration.id > id) break;
    db.exec(migration.sql);
  }
};

/**
 * ID 28, NOT 27. Moraine and I both wrote a migration 27 in the same hour —
 * theirs the room items, mine this. The runner skips an id it has already
 * applied, silently and permanently, so the second one to land would simply
 * never have run. Theirs reached main first, so this became 28.
 */
const theMigration = () => MIGRATIONS.find((m) => m.id === 28)!;

/** A database as it stood before this migration, with somebody's furniture in it. */
const populated = () => {
  const db = new DatabaseSync(":memory:");
  upTo(db, 27);
  db.prepare("INSERT INTO agent_homes (actor_key, actor_id, x, z, facing, set_by, set_at) VALUES (?,?,?,?,?,?,?)")
    .run("sill", "Sill", 1.5, 6.2, 2.1, "Sill", "2026-09-20T00:00:00.000Z");
  db.prepare("INSERT INTO agent_homes (actor_key, actor_id, x, z, facing, set_by, set_at) VALUES (?,?,?,?,?,?,?)")
    .run("nightjar", "Nightjar", -2, 4, 0, "Nightjar", "2026-09-19T00:00:00.000Z");
  db.prepare("INSERT INTO space_showing (only_row, project_id, board_id, set_by, set_at) VALUES (1,?,?,?,?)")
    .run("saha-ing", "board-1", "Nikk2", "2026-09-18T00:00:00.000Z");
  db.prepare("INSERT INTO space_panel_shown (panel_id, open, set_by, set_at) VALUES (?,?,?,?)")
    .run("taskBoard", 1, "Nikk2", "2026-09-18T00:00:00.000Z");
  db.prepare("INSERT INTO space_panel_open (actor_id, panel_id, open, at) VALUES (?,?,?,?)")
    .run("Sill", "people", 1, "2026-09-18T00:00:00.000Z");
  db.prepare("INSERT INTO space_panel_place (panel_id, x, y, z, rotation_y, scale, moved_by, moved_at) VALUES (?,?,?,?,?,?,?,?)")
    .run("taskBoard", 1, 1.4, -3, 0.5, 1.75, "Nikk2", "2026-09-18T00:00:00.000Z");
  db.prepare("INSERT INTO utterances (at, actor_id, to_actor, say, detail, source, confidence) VALUES (?,?,?,?,?,?,?)")
    .run("2026-09-18T00:00:00.000Z", "Sill", null, "hello", null, "text", null);
  return db;
};

describe("giving the space a room", () => {
  it("keeps every row, in the room that made it", () => {
    // 'saha.ing', NOT the new default. Everything that exists was made by
    // somebody standing in the dev room, so that is where they should find it.
    // Backfilling to 'lobby' would move the project's furniture into a room
    // nobody has been in and leave the builders looking at an empty space.
    const db = populated();
    db.exec(theMigration().sql);

    const homes = db.prepare("SELECT room, actor_id, x, z FROM agent_homes ORDER BY actor_id").all() as
      { room: string; actor_id: string; x: number; z: number }[];
    expect(homes).toHaveLength(2);
    expect(homes.every((h) => h.room === "saha.ing")).toBe(true);
    expect(homes[1]).toMatchObject({ actor_id: "Sill", x: 1.5, z: 6.2 });

    const showing = db.prepare("SELECT room, project_id, board_id FROM space_showing").all() as
      { room: string; project_id: string; board_id: string }[];
    expect(showing).toEqual([{ room: "saha.ing", project_id: "saha-ing", board_id: "board-1" }]);

    expect(db.prepare("SELECT room, panel_id, open FROM space_panel_shown").all())
      .toEqual([{ room: "saha.ing", panel_id: "taskBoard", open: 1 }]);
    expect(db.prepare("SELECT room, actor_id, panel_id FROM space_panel_open").all())
      .toEqual([{ room: "saha.ing", actor_id: "Sill", panel_id: "people" }]);
    // `scale` is asserted because I lost it. It is added to this table by a
    // LATER migration, so the live shape is the CREATE plus that ALTER — and
    // the first version of this rebuild copied only the CREATE's columns.
    expect(db.prepare("SELECT room, panel_id, rotation_y, scale FROM space_panel_place").all())
      .toEqual([{ room: "saha.ing", panel_id: "taskBoard", rotation_y: 0.5, scale: 1.75 }]);
    expect(db.prepare("SELECT room, say FROM utterances").all())
      .toEqual([{ room: "saha.ing", say: "hello" }]);
  });

  it("lets two rooms hold the same panel, actor and home at once", () => {
    // The point of the whole migration: before it, panel_id and actor_key were
    // primary keys on their own, so a second room could not have its own task
    // board or its own place to stand. If any of these throws, the key did not
    // actually widen and the rebuild moved a column without moving the
    // constraint — which would look completely fine until the second room.
    const db = populated();
    db.exec(theMigration().sql);

    expect(() => {
      db.prepare("INSERT INTO agent_homes (room, actor_key, actor_id, x, z, facing, set_by, set_at) VALUES (?,?,?,?,?,?,?,?)")
        .run("lobby", "sill", "Sill", 0, 0, 0, "Sill", "2026-09-21T00:00:00.000Z");
      db.prepare("INSERT INTO space_showing (room, project_id, board_id, set_by, set_at) VALUES (?,?,?,?,?)")
        .run("lobby", null, null, "Sill", "2026-09-21T00:00:00.000Z");
      db.prepare("INSERT INTO space_panel_shown (room, panel_id, open, set_by, set_at) VALUES (?,?,?,?,?)")
        .run("lobby", "taskBoard", 0, "Sill", "2026-09-21T00:00:00.000Z");
      db.prepare("INSERT INTO space_panel_open (room, actor_id, panel_id, open, at) VALUES (?,?,?,?,?)")
        .run("lobby", "Sill", "people", 0, "2026-09-21T00:00:00.000Z");
      db.prepare("INSERT INTO space_panel_place (room, panel_id, x, y, z, rotation_y, moved_by, moved_at) VALUES (?,?,?,?,?,?,?,?)")
        .run("lobby", "taskBoard", 0, 1, 0, 0, "Sill", "2026-09-21T00:00:00.000Z");
    }).not.toThrow();

    expect(db.prepare("SELECT COUNT(*) AS n FROM agent_homes WHERE actor_key='sill'").get())
      .toEqual({ n: 2 });
    // And the same actor standing in two rooms is two different spots.
    const spots = db.prepare("SELECT room, x FROM agent_homes WHERE actor_key='sill' ORDER BY room").all() as
      { room: string; x: number }[];
    expect(spots).toEqual([{ room: "lobby", x: 0 }, { room: "saha.ing", x: 1.5 }]);
  });

  it("still refuses the same panel twice in ONE room", () => {
    // Widening a key must not weaken it. If this stops throwing, the primary
    // key was dropped rather than extended and every room's furniture can be
    // duplicated.
    const db = populated();
    db.exec(theMigration().sql);
    expect(() =>
      db.prepare("INSERT INTO space_panel_shown (room, panel_id, open, set_by, set_at) VALUES (?,?,?,?,?)")
        .run("saha.ing", "taskBoard", 0, "Sill", "2026-09-21T00:00:00.000Z")).toThrow();
  });

  it("KEEPS EVERY COLUMN the rebuilt tables had, plus room", () => {
    // The general form of the bug above. A rebuild written from the CREATE
    // statement silently drops anything a later ALTER added, and the only
    // symptom is a column quietly missing from a table nobody reads today.
    // So: compare the columns before and after, per table.
    const before = new DatabaseSync(":memory:");
    upTo(before, 27);
    const columnsOf = (db: DatabaseSync, table: string) =>
      (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name).sort();

    const rebuilt = ["agent_homes", "space_showing", "space_panel_shown", "space_panel_open", "space_panel_place"];
    const was = Object.fromEntries(rebuilt.map((t) => [t, columnsOf(before, t)]));

    const after = populated();
    after.exec(theMigration().sql);
    for (const table of rebuilt) {
      const now = columnsOf(after, table);
      // space_showing swaps its pinned `only_row` for `room`; everything else
      // keeps what it had and gains one.
      const expected = table === "space_showing"
        ? [...was[table].filter((c) => c !== "only_row"), "room"].sort()
        : [...was[table], "room"].sort();
      expect(now, `${table} lost or gained a column`).toEqual(expected);
    }
  });

  it("does not put a room on the things that are yours", () => {
    // Your body, your voice, your memories and your profile follow you between
    // rooms. Re-picking a body per room would be a worse product and a stranger
    // idea of a self, so these deliberately have no room column — asserted so
    // a later migration does not add one without arguing with this.
    const db = populated();
    db.exec(theMigration().sql);
    for (const table of ["agent_bodies", "agent_voices", "memories", "actors"]) {
      const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[])
        .map((c) => c.name);
      expect(columns, `${table} must not be room-scoped`).not.toContain("room");
    }
  });
});
