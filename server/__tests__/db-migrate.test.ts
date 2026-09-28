import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db/open.js";
import { MIGRATIONS } from "../db/schema.js";
import { RoomMindfulnessCards } from "../space/mindfulness.js";

const fresh = () => openDatabase(":memory:", DatabaseSync);

function databaseBeforeMindfulnessShareLedger() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE schema_migrations (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  for (const migration of MIGRATIONS.filter((entry) => entry.id < 41)) {
    db.exec("BEGIN");
    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
      .run(migration.id, migration.name, "2026-09-28T00:00:00.000Z");
    db.exec("COMMIT");
  }
  return db;
}

describe("migrations", () => {
  it("brings an empty database up to date", () => {
    const db = fresh();
    const applied = db.prepare("SELECT id FROM schema_migrations ORDER BY id").all() as Array<{ id: number }>;

    expect(applied.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it("is idempotent — running again applies nothing", () => {
    const db = fresh();

    expect(migrate(db)).toBe(0);
  });

  it("backfills only recent author/timestamp metadata when upgrading the mindfulness quota ledger", () => {
    const db = databaseBeforeMindfulnessShareLedger();
    const now = Date.now();
    const insertCard = db.prepare(
      "INSERT INTO space_mindfulness_cards (id, room, text, created_by, created_at) VALUES (?, ?, ?, ?, ?)",
    );
    for (let i = 0; i < 8; i += 1) {
      insertCard.run(`recent-${i}`, "meditation.ar", `private reflection ${i}`, "inkstone", new Date(now - i * 60_000).toISOString());
    }
    insertCard.run("other-author", "meditation.ar", "another reflection", "sill", new Date(now - 60_000).toISOString());
    insertCard.run("other-room", "quiet-garden", "room-local reflection", "inkstone", new Date(now - 60_000).toISOString());
    insertCard.run("expired", "meditation.ar", "old reflection", "inkstone", new Date(now - 25 * 60 * 60_000).toISOString());

    expect(migrate(db)).toBe(1);
    const events = db.prepare(
      "SELECT room, created_by, created_at FROM space_mindfulness_share_events ORDER BY room, created_by, created_at",
    ).all() as Array<{ room: string; created_by: string; created_at: string }>;
    expect(events).toHaveLength(10);
    expect(JSON.stringify(events)).not.toContain("reflection");
    expect(events.some((event) => event.created_at === new Date(now - 25 * 60 * 60_000).toISOString())).toBe(false);

    const cards = new RoomMindfulnessCards(db);
    expect("refused" in cards.share("meditation.AR", "Inkstone", "One more", Date.now())).toBe(true);
    expect("refused" in cards.share("meditation.AR", "Sill", "Within remaining quota", Date.now())).toBe(false);
    expect("refused" in cards.share("quiet-garden", "Inkstone", "A different room", Date.now())).toBe(false);
  });

  it("enforces foreign keys, which SQLite does NOT do by default", () => {
    // Without the pragma every REFERENCES clause in schema.ts is decoration,
    // and a board item could point at a blob that does not exist.
    const db = fresh();

    expect(() =>
      db.prepare("INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?,?,?,?,?)")
        .run("t1", "no-such-project", "orphan", "now", "now"),
    ).toThrow();
  });

  it("refuses a status the board does not have", () => {
    const db = fresh();
    db.prepare("INSERT INTO projects (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("p", "P", "me", "now", "now");

    expect(() =>
      db.prepare("INSERT INTO tasks (id,project_id,title,status,created_at,updated_at) VALUES (?,?,?,?,?,?)")
        .run("t", "p", "T", "nearly_done", "now", "now"),
    ).toThrow();
  });

  it("lets kind be absent, because absent means nobody said", () => {
    // A DEFAULT here would invent an answer. An untriaged card must stay
    // visibly untriaged.
    const db = fresh();
    db.prepare("INSERT INTO projects (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("p", "P", "me", "now", "now");
    db.prepare("INSERT INTO tasks (id,project_id,title,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("t", "p", "T", "now", "now");

    const row = db.prepare("SELECT kind, priority FROM tasks WHERE id='t'").get() as Record<string, unknown>;
    expect(row.kind).toBeNull();
    expect(row.priority).toBeNull();
  });

  it("refuses a board item that is both an upload and a link", () => {
    const db = fresh();
    db.prepare("INSERT INTO projects (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("p", "P", "me", "now", "now");
    db.prepare("INSERT INTO boards (id,project_id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("b", "p", "Mood", "me", "now", "now");
    db.prepare("INSERT INTO blobs (id,sha256,mime,bytes,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?)")
      .run("bl", "abc", "image/png", 10, "me", "now");

    expect(() =>
      db.prepare(
        "INSERT INTO board_items (id,board_id,kind,blob_id,url,added_by,added_at) VALUES (?,?,?,?,?,?,?)",
      ).run("i", "b", "image", "bl", "https://example.test/x.png", "me", "now"),
    ).toThrow();
  });

  it("will not delete a blob that a board still shows", () => {
    // ON DELETE RESTRICT: removing the bytes out from under a board would leave
    // an item that renders as a broken box with no explanation.
    const db = fresh();
    db.prepare("INSERT INTO projects (id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?)")
      .run("p", "P", "me", "now", "now");
    db.prepare("INSERT INTO boards (id,project_id,name,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .run("b", "p", "Mood", "me", "now", "now");
    db.prepare("INSERT INTO blobs (id,sha256,mime,bytes,uploaded_by,uploaded_at) VALUES (?,?,?,?,?,?)")
      .run("bl", "abc", "image/png", 10, "me", "now");
    db.prepare("INSERT INTO board_items (id,board_id,kind,blob_id,added_by,added_at) VALUES (?,?,?,?,?,?)")
      .run("i", "b", "image", "bl", "me", "now");

    expect(() => db.prepare("DELETE FROM blobs WHERE id='bl'").run()).toThrow();
  });

  it("keeps ownership and membership in separate tables with nothing joining them", () => {
    // The security rule as a schema fact rather than a sentence: there is no
    // column anywhere that could let ownership imply membership.
    const db = fresh();
    const columns = (name: string) =>
      (db.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((c) => c.name);

    expect(columns("ownerships")).not.toContain("project_id");
    expect(columns("memberships")).not.toContain("owner_id");
  });
});
