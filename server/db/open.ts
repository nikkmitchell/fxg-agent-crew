import { MIGRATIONS } from "./schema.js";

type Db = import("node:sqlite").DatabaseSync;

/**
 * Open the database and bring it up to date.
 *
 * Migrations run inside a transaction each, and the version is recorded in the
 * same transaction that applies it — so a crash halfway leaves the database at
 * the previous version rather than at a version it does not actually have.
 *
 * `foreign_keys` is ON deliberately. SQLite defaults it OFF, which means every
 * REFERENCES clause in schema.ts would be decoration: a board item could point
 * at a deleted blob and nothing would say so until it failed to render.
 */
export function openDatabase(path: string, DatabaseSync: new (p: string) => Db): Db {
  const db = new DatabaseSync(path);
  // WAL so a reader never blocks the writer. Agents will hold read-only handles
  // on this file while the app writes to it.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  // Wait rather than fail when another connection holds the write lock.
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    (db.prepare("SELECT id FROM schema_migrations").all() as Array<{ id: number }>).map((r) => r.id),
  );

  let ran = 0;
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)")
        .run(migration.id, migration.name, new Date().toISOString());
      db.exec("COMMIT");
      ran += 1;
    } catch (error) {
      db.exec("ROLLBACK");
      // Named, because "SQLITE_ERROR: near ..." with no migration id sends the
      // next person reading the whole schema file.
      throw new Error(`migration ${migration.id} (${migration.name}) failed: ${String(error)}`);
    }
  }
  return ran;
}

/**
 * A read-only handle on the same file.
 *
 * This is what an agent gets. A reader cannot corrupt anything, so reads need
 * no API in front of them — and being unable to write is enforced by SQLite
 * rather than by our remembering to check.
 */
export function openReadOnly(path: string, DatabaseSync: new (p: string, o?: unknown) => Db): Db {
  const db = new DatabaseSync(path, { readOnly: true });
  db.exec("PRAGMA busy_timeout = 5000");
  return db;
}
