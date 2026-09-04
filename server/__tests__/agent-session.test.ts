import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MemorySessionStore, SqliteSessionStore } from "../session.js";

/**
 * Agent sessions.
 *
 * The security question these answer is narrow: does labelling a session as an
 * agent's change what that session can do, or leak anything it did not already?
 * It must not. `kind` says who acted. It grants nothing.
 */
describe("session kind", () => {
  it("defaults to human, so an unlabelled call cannot mint an agent", () => {
    const store = new MemorySessionStore(60_000);
    expect(store.get(store.create("nikk", "t"))!.kind).toBe("human");
    store.close();
  });

  it("records an agent when asked", () => {
    const store = new MemorySessionStore(60_000);
    expect(store.get(store.create("claude-nikk2mbp", "t", "agent"))!.kind).toBe("agent");
    store.close();
  });

  it("still hides the token from an agent's public view", () => {
    // The invariant must not weaken for the new path. An agent's upstream token
    // is at least as sensitive as a human's: it is a long-lived bearer token
    // rather than a session sitting behind a password.
    const secret = "agent-token-that-must-never-reach-the-browser";
    const store = new MemorySessionStore(60_000);
    const session = store.get(store.create("claude-nikk2mbp", secret, "agent"))!;
    const view = store.publicView(session);

    expect(JSON.stringify(view)).not.toContain(secret);
    expect(Object.keys(view).sort()).toEqual(["kind", "username"]);
    store.close();
  });
});

describe("the kind column migration", () => {
  it("adds kind to a database created before the column existed", () => {
    // The production case. sessions.db already exists with someone signed into
    // it, and CREATE TABLE IF NOT EXISTS does nothing to an existing table — so
    // without a migration the column is present on fresh machines and missing
    // exactly where it matters.
    const dir = mkdtempSync(join(tmpdir(), "fxg-migrate-"));
    const path = join(dir, "sessions.db");
    try {
      const old = new DatabaseSync(path);
      old.exec(
        "CREATE TABLE sessions (sid TEXT PRIMARY KEY, username TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL);",
      );
      old
        .prepare("INSERT INTO sessions (sid, username, token, expires_at) VALUES (?, ?, ?, ?)")
        .run("pre-existing-sid", "nikk", "still-valid-token", Date.now() + 3_600_000);
      old.close();

      const store = new SqliteSessionStore(60_000, path, DatabaseSync);
      const survivor = store.get("pre-existing-sid");

      // Signed in before the upgrade, still signed in after. A migration that
      // logs everyone out in order to add a label is not an acceptable trade.
      expect(survivor?.username).toBe("nikk");
      expect(survivor?.token).toBe("still-valid-token");
      // Rows written before the column existed were human logins, because that
      // was the only way in.
      expect(survivor?.kind).toBe("human");
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent across restarts", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxg-migrate-twice-"));
    const path = join(dir, "sessions.db");
    try {
      const first = new SqliteSessionStore(60_000, path, DatabaseSync);
      const sid = first.create("claude-nikk2mbp", "t", "agent");
      first.close();

      // Opening again must not attempt the ALTER a second time, which would
      // throw and take the service down on its SECOND boot — a failure that
      // never appears on a fresh machine.
      const second = new SqliteSessionStore(60_000, path, DatabaseSync);
      expect(second.get(sid)?.kind).toBe("agent");
      second.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads an unrecognised kind as human rather than inventing a third state", () => {
    const dir = mkdtempSync(join(tmpdir(), "fxg-migrate-junk-"));
    const path = join(dir, "sessions.db");
    try {
      const store = new SqliteSessionStore(60_000, path, DatabaseSync);
      const sid = store.create("nikk", "t");
      store.close();

      const raw = new DatabaseSync(path);
      raw.prepare("UPDATE sessions SET kind = ? WHERE sid = ?").run("superuser", sid);
      raw.close();

      const reopened = new SqliteSessionStore(60_000, path, DatabaseSync);
      expect(reopened.get(sid)?.kind).toBe("human");
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
