/**
 * The schema, as migrations rather than as a CREATE TABLE nobody can change.
 *
 * `CREATE TABLE IF NOT EXISTS` does nothing to a database that already exists,
 * so a column added later is present on fresh machines and absent in production
 * — which is precisely the bug session.ts had to grow `addKindColumn` to fix.
 * Every change here is a numbered step recorded in `schema_migrations`, applied
 * once, in order.
 *
 * WHAT THE SHAPE ENCODES, per ADR-002:
 *
 * - NOT NULL where we genuinely know, nullable where we do not. `kind` on a
 *   task is nullable because absent means NOBODY SAID, which is a different
 *   fact from "decision", and a DEFAULT here would invent the answer.
 * - Ownership is a separate table from membership, and nothing joins one to the
 *   other. Operating an agent grants no project authority; the schema is where
 *   that stops being a sentence and starts being a fact.
 * - `audit` is written beside every change. It is history, not the store.
 */

export type Migration = { id: number; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: "board",
    sql: `
      CREATE TABLE projects (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        summary     TEXT NOT NULL DEFAULT '',
        created_by  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      CREATE TABLE project_goals (
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        position    INTEGER NOT NULL,
        text        TEXT NOT NULL,
        PRIMARY KEY (project_id, position)
      );

      CREATE TABLE tasks (
        id          TEXT PRIMARY KEY,
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        -- No length cap. The 2000-character limit was a property of the chat
        -- transport, and it made eleven cards uneditable; it is not a property
        -- of a brief.
        description TEXT,
        status      TEXT NOT NULL DEFAULT 'backlog'
                      CHECK (status IN ('backlog','assigned','in_progress','blocked','review','done')),
        -- Nullable on purpose: absent means nobody said, which is not 'build'.
        kind        TEXT CHECK (kind IS NULL OR kind IN ('build','decision')),
        points      INTEGER NOT NULL DEFAULT 1 CHECK (points >= 0),
        priority    INTEGER CHECK (priority IS NULL OR priority > 0),
        blocker     TEXT,
        assignee_id TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX tasks_by_project_status ON tasks(project_id, status);
      CREATE INDEX tasks_by_assignee ON tasks(assignee_id);

      CREATE TABLE task_owners (
        task_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        actor_id  TEXT NOT NULL,
        -- Assigned and accepted are different states. A card someone was given
        -- and has not agreed to is not the same as one they took.
        accepted  INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0,1)),
        PRIMARY KEY (task_id, actor_id)
      );

      CREATE TABLE comments (
        id         TEXT PRIMARY KEY,
        task_id    TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_id  TEXT NOT NULL,
        body       TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX comments_by_task ON comments(task_id, created_at);

      CREATE TABLE task_links (
        id       TEXT PRIMARY KEY,
        task_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        label    TEXT NOT NULL,
        href     TEXT NOT NULL
      );
      CREATE INDEX task_links_by_task ON task_links(task_id);
    `,
  },
  {
    id: 2,
    name: "people",
    sql: `
      CREATE TABLE actors (
        id              TEXT PRIMARY KEY,
        kind            TEXT CHECK (kind IS NULL OR kind IN ('human','agent')),
        display_name    TEXT,
        bio             TEXT,
        coarse_location TEXT,
        time_zone       TEXT,
        model           TEXT,
        runtime         TEXT,
        first_seen_at   TEXT NOT NULL,
        updated_at      TEXT NOT NULL
      );

      CREATE TABLE memberships (
        project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        actor_id    TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
        roles       TEXT NOT NULL DEFAULT '[]',
        active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
        -- An unattributable grant is indistinguishable from one nobody made.
        granted_by  TEXT NOT NULL,
        granted_at  TEXT NOT NULL,
        PRIMARY KEY (project_id, actor_id)
      );

      -- Deliberately NOT joined to memberships anywhere. Ownership is lineage:
      -- who is answerable for this instrument. It confers nothing.
      CREATE TABLE ownerships (
        agent_id   TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
        owner_id   TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
        state      TEXT NOT NULL CHECK (state IN ('pending','verified','revoked')),
        claimed_at TEXT NOT NULL,
        settled_at TEXT,
        PRIMARY KEY (agent_id, owner_id)
      );
    `,
  },
  {
    id: 3,
    name: "blobs and boards",
    sql: `
      CREATE TABLE blobs (
        id          TEXT PRIMARY KEY,
        -- Content-addressed: the hash IS the integrity check, and identical
        -- uploads collapse to one file without anyone arranging it.
        sha256      TEXT NOT NULL UNIQUE,
        mime        TEXT NOT NULL,
        bytes       INTEGER NOT NULL CHECK (bytes > 0),
        width       INTEGER,
        height      INTEGER,
        filename    TEXT,
        uploaded_by TEXT NOT NULL,
        uploaded_at TEXT NOT NULL
      );

      CREATE TABLE boards (
        id         TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX boards_by_project ON boards(project_id);

      CREATE TABLE board_items (
        id       TEXT PRIMARY KEY,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        kind     TEXT NOT NULL CHECK (kind IN ('image','link','note','swatch')),
        -- Exactly one source, enforced rather than trusted: an item that is
        -- both an upload and a link is a bug someone would otherwise have to
        -- find at render time.
        blob_id  TEXT REFERENCES blobs(id) ON DELETE RESTRICT,
        url      TEXT,
        text     TEXT,
        caption  TEXT,
        x        REAL NOT NULL DEFAULT 0,
        y        REAL NOT NULL DEFAULT 0,
        w        REAL NOT NULL DEFAULT 240 CHECK (w > 0),
        h        REAL NOT NULL DEFAULT 240 CHECK (h > 0),
        z        INTEGER NOT NULL DEFAULT 0,
        added_by TEXT NOT NULL,
        added_at TEXT NOT NULL,
        CHECK (
          (kind = 'image'  AND blob_id IS NOT NULL AND url IS NULL) OR
          (kind = 'link'   AND url IS NOT NULL AND blob_id IS NULL) OR
          (kind IN ('note','swatch') AND text IS NOT NULL AND blob_id IS NULL AND url IS NULL)
        )
      );
      CREATE INDEX board_items_by_board ON board_items(board_id, z);
    `,
  },
  {
    id: 4,
    name: "audit",
    sql: `
      -- History, not the store. Written beside every change so "who moved this
      -- card, and when" survives, which is the one thing the chat log gave us
      -- that ordinary tables do not.
      CREATE TABLE audit (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        at        TEXT NOT NULL,
        actor_id  TEXT NOT NULL,
        action    TEXT NOT NULL,
        entity    TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        before    TEXT,
        after     TEXT
      );
      CREATE INDEX audit_by_entity ON audit(entity, entity_id, id);
      CREATE INDEX audit_by_actor ON audit(actor_id, id);
    `,
  },
];
