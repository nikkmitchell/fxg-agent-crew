import { randomBytes } from "node:crypto";
import { DEFAULT_SPACE_ROOM, roomKey } from "../shared/space-room.js";
import { actorKey } from "../shared/space-layout.js";

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
  /**
   * Which room's space this session is standing in.
   *
   * ON THE SESSION RATHER THAN EVERY REQUEST, because the alternative is a
   * `?room=` on twenty-odd space routes and a socket, and one of them would be
   * forgotten — a space route that quietly reads the wrong room shows you a
   * room full of the wrong people with nothing to indicate it.
   *
   * Undefined means "has not chosen", which resolves to DEFAULT_SPACE_ROOM
   * rather than being written in at sign-in: the default is one decision in
   * one file, and an undefined here can still be told apart from a deliberate
   * choice of the same room.
   */
  spaceRoom?: string;
  /** Newly signed-in users must choose a room verified against upstream before
   * any room-scoped route can read the legacy default space. */
  requiresRoomEntry?: boolean;
};

export interface SessionStore {
  create(username: string, token: string, kind?: SessionKind): string;
  /** Production sign-in: do not grant the historical default room implicitly. */
  createUnselected(username: string, token: string, kind?: SessionKind): string;
  get(sid: string | undefined): Session | undefined;
  /** Replace the upstream token after a transparent re-login, keeping the sid. */
  refreshToken(sid: string, token: string): void;
  /** Stand this session in a different room's space. */
  enterRoom(sid: string, room: string): void;
  /** Legacy board activity may place this actor in the default room only when
   * no active session explicitly places every copy of them elsewhere. */
  mayInferInDefaultRoom(actorId: string): boolean;
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
  private readonly lastRoomByActor = new Map<string, string>();

  constructor(private readonly ttlMs: number) {}

  create(username: string, token: string, kind: SessionKind = "human"): string {
    const sid = newSessionId();
    this.sessions.set(sid, { username, token, kind, expiresAt: Date.now() + this.ttlMs });
    return sid;
  }

  createUnselected(username: string, token: string, kind: SessionKind = "human"): string {
    const sid = this.create(username, token, kind);
    this.sessions.get(sid)!.requiresRoomEntry = true;
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

  enterRoom(sid: string, room: string): void {
    const session = this.sessions.get(sid);
    if (!session) return;
    session.spaceRoom = roomKey(room);
    session.requiresRoomEntry = false;
    this.lastRoomByActor.set(actorKey(session.username), session.spaceRoom);
  }

  mayInferInDefaultRoom(actorId: string): boolean {
    let hasActiveSession = false;
    for (const session of this.sessions.values()) {
      if (session.expiresAt <= Date.now() || actorKey(session.username) !== actorKey(actorId)) continue;
      hasActiveSession = true;
      if (!session.requiresRoomEntry && roomKey(session.spaceRoom ?? DEFAULT_SPACE_ROOM) === DEFAULT_SPACE_ROOM) return true;
    }
    if (hasActiveSession) return false;
    // A session can expire after an agent left the development room. Its last
    // verified choice still outranks the old audit trail on the next restart.
    return (this.lastRoomByActor.get(actorKey(actorId)) ?? DEFAULT_SPACE_ROOM) === DEFAULT_SPACE_ROOM;
  }

  destroy(sid: string | undefined): void {
    if (!sid) return;
    this.sessions.delete(sid);
  }

  publicView = publicViewOf;

  close(): void {
    this.sessions.clear();
    this.lastRoomByActor.clear();
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
 *
 * `server/space/presence.ts` has the SAME limit for the same reason, and is
 * noted here so the day someone adds a second replica they find both from one
 * place rather than one of them.
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
    this.addSpaceRoomColumn();
    this.addRoomEntryColumn();
    this.db.exec(`CREATE TABLE IF NOT EXISTS actor_space_choices (
      actor_key TEXT PRIMARY KEY,
      room_name TEXT NOT NULL
    )`);
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

  /**
   * Add `space_room` the same way, and for the same reason.
   *
   * NULLABLE, with no default. "Has not chosen a room" is a real state that
   * resolves to DEFAULT_SPACE_ROOM at read time; writing a default in here
   * would make every session already signed in look like it had picked the dev
   * room on purpose, and there would be no way to tell those apart later.
   */
  private addSpaceRoomColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "space_room")) return;
    this.db.exec("ALTER TABLE sessions ADD COLUMN space_room TEXT");
  }

  /** Existing sessions keep their pre-lobby default access; new sign-ins do
   * not. This migration is additive so a release does not sign everyone out. */
  private addRoomEntryColumn(): void {
    const columns = this.db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
    if (columns.some((column) => column.name === "requires_room_entry")) return;
    this.db.exec("ALTER TABLE sessions ADD COLUMN requires_room_entry INTEGER NOT NULL DEFAULT 0");
  }

  create(username: string, token: string, kind: SessionKind = "human"): string {
    const sid = newSessionId();
    this.db
      .prepare("INSERT INTO sessions (sid, username, token, kind, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(sid, username, token, kind, Date.now() + this.ttlMs);
    return sid;
  }

  createUnselected(username: string, token: string, kind: SessionKind = "human"): string {
    const sid = newSessionId();
    this.db.prepare("INSERT INTO sessions (sid, username, token, kind, expires_at, requires_room_entry) VALUES (?, ?, ?, ?, ?, 1)")
      .run(sid, username, token, kind, Date.now() + this.ttlMs);
    return sid;
  }

  get(sid: string | undefined): Session | undefined {
    if (!sid) return undefined;
    const row = this.db
      .prepare("SELECT username, token, kind, expires_at, space_room, requires_room_entry FROM sessions WHERE sid = ?")
      .get(sid) as
        { username: string; token: string; kind: string; expires_at: number; space_room: string | null; requires_room_entry: number } | undefined;
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
      spaceRoom: row.space_room ?? undefined,
      requiresRoomEntry: row.requires_room_entry === 1,
    };
  }

  refreshToken(sid: string, token: string): void {
    this.db
      .prepare("UPDATE sessions SET token = ?, expires_at = ? WHERE sid = ?")
      .run(token, Date.now() + this.ttlMs, sid);
  }

  enterRoom(sid: string, room: string): void {
    const session = this.get(sid);
    if (!session) return;
    const wanted = roomKey(room);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("UPDATE sessions SET space_room = ?, requires_room_entry = 0 WHERE sid = ?").run(wanted, sid);
      this.db.prepare(`INSERT INTO actor_space_choices (actor_key, room_name) VALUES (?, ?)
        ON CONFLICT(actor_key) DO UPDATE SET room_name = excluded.room_name`)
        .run(actorKey(session.username), wanted);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  mayInferInDefaultRoom(actorId: string): boolean {
    const row = this.db.prepare(`
      SELECT COUNT(*) AS active,
             SUM(CASE WHEN requires_room_entry = 0 AND (space_room IS NULL OR lower(trim(space_room)) = ?) THEN 1 ELSE 0 END) AS in_default
        FROM sessions WHERE lower(trim(username)) = ? AND expires_at > ?
    `).get(DEFAULT_SPACE_ROOM, actorKey(actorId), Date.now()) as { active: number; in_default: number | null };
    if (row.active > 0) return (row.in_default ?? 0) > 0;
    const choice = this.db.prepare("SELECT room_name FROM actor_space_choices WHERE actor_key = ?")
      .get(actorKey(actorId)) as { room_name: string } | undefined;
    return roomKey(choice?.room_name ?? DEFAULT_SPACE_ROOM) === DEFAULT_SPACE_ROOM;
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
