import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS } from "../db/schema.js";

/**
 * Migration 15 collapses per-person panel visibility into one shared set.
 *
 * TESTED BECAUSE IT TOUCHES DATA THAT ALREADY EXISTS. Every other migration
 * here creates empty tables, so running them proves they parse. This one reads
 * rows people made and decides which of their disagreements wins, and the rest
 * of the suite would pass whether that SELECT were right or nonsense — the
 * seeding only does anything on a database with history in it, which is
 * production and nowhere else.
 */
const upTo = (db: DatabaseSync, id: number) => {
  for (const migration of MIGRATIONS) {
    if (migration.id > id) break;
    db.exec(migration.sql);
  }
};

const seed = (db: DatabaseSync, rows: [string, string, number, string][]) => {
  for (const [actor, panel, open, at] of rows) {
    db.prepare("INSERT INTO space_panel_open (actor_id, panel_id, open, at) VALUES (?,?,?,?)")
      .run(actor, panel, open, at);
  }
};

const shown = (db: DatabaseSync) =>
  db.prepare("SELECT panel_id, open, set_by FROM space_panel_shown ORDER BY panel_id").all() as
    { panel_id: string; open: number; set_by: string }[];

const fifteen = () => MIGRATIONS.find((m) => m.id === 15)!;

describe("collapsing per-person panel visibility into the room's", () => {
  it("takes the most recent decision when people disagree", () => {
    // The rule the migration's comment states. A union would silently reopen
    // panels somebody deliberately closed; picking a person needs a rule about
    // which person. The latest decision is the latest thing a human expressed.
    const db = new DatabaseSync(":memory:");
    upTo(db, 14);
    seed(db, [
      ["wren", "people", 0, "2026-09-14T08:00:00.000Z"],
      ["nikk", "people", 1, "2026-09-14T09:00:00.000Z"],
      ["sill", "moodBoard", 1, "2026-09-14T07:00:00.000Z"],
      ["nikk", "moodBoard", 0, "2026-09-14T10:00:00.000Z"],
    ]);
    db.exec(fifteen().sql);

    expect(shown(db)).toEqual([
      { panel_id: "moodBoard", open: 0, set_by: "nikk" },
      { panel_id: "people", open: 1, set_by: "nikk" },
    ]);
  });

  it("keeps a panel only one person ever had an opinion about", () => {
    const db = new DatabaseSync(":memory:");
    upTo(db, 14);
    seed(db, [["wren", "taskBoard", 0, "2026-09-14T06:00:00.000Z"]]);
    db.exec(fifteen().sql);
    expect(shown(db)).toEqual([{ panel_id: "taskBoard", open: 0, set_by: "wren" }]);
  });

  it("leaves the room on its defaults when nobody had ever decided", () => {
    // No rows means no rows: the defaults in shared/space-layout.ts fill the
    // gap, which keeps "nobody has touched this" distinguishable from
    // "somebody set it back to exactly the default".
    const db = new DatabaseSync(":memory:");
    upTo(db, 14);
    db.exec(fifteen().sql);
    expect(shown(db)).toEqual([]);
  });

  it("leaves the old table intact, so a rollback still finds its data", () => {
    // Nikk: "we can easily roll back if anything breaks" — and a rollback that
    // finds its data gone is not a rollback.
    const db = new DatabaseSync(":memory:");
    upTo(db, 14);
    seed(db, [
      ["wren", "people", 0, "2026-09-14T08:00:00.000Z"],
      ["nikk", "people", 1, "2026-09-14T09:00:00.000Z"],
    ]);
    db.exec(fifteen().sql);
    const left = db.prepare("SELECT COUNT(*) AS n FROM space_panel_open").get() as { n: number };
    expect(left.n).toBe(2);
  });

  it("writes one row per panel and no more, whatever the history", () => {
    // A shared fact with two rows in it eventually reads as two facts.
    const db = new DatabaseSync(":memory:");
    upTo(db, 14);
    seed(db, [
      ["a", "people", 1, "2026-09-14T01:00:00.000Z"],
      ["b", "people", 0, "2026-09-14T02:00:00.000Z"],
      ["c", "people", 1, "2026-09-14T03:00:00.000Z"],
      ["d", "people", 0, "2026-09-14T04:00:00.000Z"],
    ]);
    db.exec(fifteen().sql);
    const rows = shown(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ panel_id: "people", open: 0, set_by: "d" });
  });
});
