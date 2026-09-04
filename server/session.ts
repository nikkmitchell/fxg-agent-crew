import { randomBytes } from "node:crypto";

/**
 * Server-side session storage.
 *
 * The security invariant of the whole BFF lives here: the WebHarness bearer
 * token is held ONLY on the server, keyed by an opaque session id. The browser
 * receives that id in an httpOnly cookie and never sees the token, so an XSS on
 * the page cannot exfiltrate credentials for the chat backend.
 *
 * That invariant is why sessions are stored rather than encoded into a signed
 * cookie. A stateless cookie would survive restarts for free — and would put
 * the token, however encrypted, into the browser. Not worth it.
 */

/**
 * Who is behind a session.
 *
 * Recorded so the UI can label an agent's actions as an agent's. Agents are
 * first-class users of this product, not humans in disguise, and a board where
 * you cannot tell which is which is a board that misattributes work.
 *
 * This is a LABEL, not a permission. It says who acted; it grants nothing.
 */
export type SessionKind = "human" | "agent";

export type Session = {
  username: string;
  /** WebHarness bearer token. MUST NOT be serialized to the client. */
  token: string;
  kind: SessionKind;
  expiresAt: number;
};

export interface SessionStore {
  create(username: string, token: string, kind?: SessionKind): string;
  get(sid: string | undefined): Session | undefined;
  /** Replace the upstream token after a transparent re-login, keeping the sid. */
  refreshToken(sid: string, token: string): void;
  destroy(sid: string | undefined): void;
  /** Projection safe to send to the browser. */
  publicView(session: Session): { username: string; kind: SessionKind };
  close(): void;
}

const newSessionId = () => randomBytes(32).toString("base64url");

/** Shared by both stores so `publicView` cannot drift apart between them. */
function publicViewOf(session: Session): { username: string; kind: SessionKind } {
  // Enumerated explicitly rather than spreading the session and deleting the
  // token. A spread leaks any field added later by default; this leaks nothing
  // unless someone writes the line to do it.
  return { username: session.username, kind: session.kind };
}

/**
 * In-memory sessions. Correct, fast, and lost on restart.
 *
 * The right choice for tests and local development. Not for a deployment: a
 * cloud platform restarting a container signs every human out with no warning
 * and no way to tell that is what happened.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ttlMs: number) {}

  create(username: string, token: string, kind: SessionKind = "human"): string {
    const sid = newSessionId();
    this.sessions.set(sid, { username, token, kind, expiresAt: Date.now() + this.ttlMs });
    return sid;
  }

  get(sid: string | undefined): Session | undefined {
    if (!sid) return undefined;
    const session = this.sessions.get(sid);
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.destroy(sid);
      return undefined;
    }
    return session;
  }

  refreshToken(sid: string, token: string): void {
    const session = this.sessions.get(sid);
    if (!session) return;
    session.token = token;
    session.expiresAt = Date.now() + this.ttlMs;
  }

  destroy(sid: string | undefined): void {
    if (!sid) return;
    this.sessions.delete(sid);
  }

  publicView = publicViewOf;

  close(): void {
    this.sessions.clear();
  }
}

/**
 * Sessions on disk, via node:sqlite — built into Node, so there is no new
 * dependency and nothing extra for an operator to run.
 *
 * WHAT THIS SOLVES: a restart. The process comes back and people are still
 * signed in. Message position remains browser-owned: the server must not resume
 * from a cursor unless the browser also retained the transcript before it.
 *
 * WHAT IT DOES NOT SOLVE, stated here so "durable" cannot be read as
 * "distributed": several instances do not share this unless they share the
 * file, and a SQLite file on network storage is a known way to corrupt a
 * database. Running more than one replica needs Redis or a real database
 * server. The interface above is the seam for that; this is not it.
 */
export class SqliteSessionStore implements SessionStore {
  private readonly db: import("node:sqlite").DatabaseSync;

  constructor(
    private readonly ttlMs: number,
    path: string,
    DatabaseSync: typeof import("node:sqlite").DatabaseSync,
  ) {
    this.db = new DatabaseSync(path);
    // WAL keeps a reader from blocking the writer, which matters because a
    // long-poll can hold a request open for 30s.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
    this.addKindColumn();
    this.db.exec("PRAGMA foreign_keys = ON");
    this.purgeExpired();
  }

  /**
   * Expired rows are deleted on startup rather than left to accumulate. A
   * lookup also checks expiry, so a stale row can never authenticate — this is
   * housekeeping, not the security boundary.
   */
  private purgeExpired(): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());
  }

  /**
   * Add `kind` to a table that already exists.
   *
   * CREATE TABLE IF NOT EXISTS does nothing to a database created before this
   * column, so without a migration the column is present on fresh machines and
   * absent in production — where people are currently signed in. Rows written
   * before this default to "human", which is what they were.
   *
   * Guarded by inspecting the schema rather than catching the error, so a
   * genuine failure is not swallowed alongside the expected one.
   */
  private addKindColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "kind")) return;
    this.db.exec("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'human'");
  }

  create(username: string, token: string, kind: SessionKind = "human"): string {
    const sid = newSessionId();
    this.db
      .prepare("INSERT INTO sessions (sid, username, token, kind, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(sid, username, token, kind, Date.now() + this.ttlMs);
    return sid;
  }

  get(sid: string | undefined): Session | undefined {
    if (!sid) return undefined;
    const row = this.db
      .prepare("SELECT username, token, kind, expires_at FROM sessions WHERE sid = ?")
      .get(sid) as { username: string; token: string; kind: string; expires_at: number } | undefined;
    if (!row) return undefined;

    if (row.expires_at <= Date.now()) {
      this.destroy(sid);
      return undefined;
    }
    // Anything that is not exactly "agent" reads as human. An unrecognised
    // value must not become a third, silently different kind.
    return {
      username: row.username,
      token: row.token,
      kind: row.kind === "agent" ? "agent" : "human",
      expiresAt: row.expires_at,
    };
  }

  refreshToken(sid: string, token: string): void {
    this.db
      .prepare("UPDATE sessions SET token = ?, expires_at = ? WHERE sid = ?")
      .run(token, Date.now() + this.ttlMs, sid);
  }

  destroy(sid: string | undefined): void {
    if (!sid) return;
    this.db.prepare("DELETE FROM sessions WHERE sid = ?").run(sid);
  }

  publicView = publicViewOf;

  close(): void {
    this.db.close();
  }
}
