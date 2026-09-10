import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrate, openDatabase } from "../db/open.js";
import { MIGRATIONS } from "../db/schema.js";

const fresh = () => openDatabase(":memory:", DatabaseSync);

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
