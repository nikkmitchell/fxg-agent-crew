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
  {
    id: 5,
    name: "denials",
    sql: `
      -- REFUSALS ARE A SECURITY SIGNAL, and I had made them invisible.
      --
      -- The business audit is transactional: a refused write rolls back and
      -- leaves no row, which is right, because a record of a change that did
      -- not happen would be a lie about the board. I then reasoned from that to
      -- "a refusal leaves no trace", and wrote a test asserting it. Inkstone
      -- caught it: repeated denials are how you see someone probing, or a
      -- permission that has broken. Making them leave nothing is the
      -- validated-is-not-authorized discipline inverted.
      --
      -- So denials go HERE, written outside the transaction so they survive the
      -- rollback that erases the attempt itself.
      CREATE TABLE security_audit (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        at        TEXT NOT NULL,
        actor_id  TEXT NOT NULL,
        action    TEXT NOT NULL,
        target    TEXT,
        code      TEXT NOT NULL,
        reason    TEXT NOT NULL
      );
      CREATE INDEX security_audit_by_actor ON security_audit(actor_id, id);
      CREATE INDEX security_audit_by_code ON security_audit(code, id);
    `,
  },
  {
    id: 6,
    name: "request envelopes",
    sql: `
      -- What was ASKED, not only what changed.
      --
      -- An agent's board change is currently signed at source with its Ed25519
      -- key, so nobody — including us — can forge one. Moving writes to an API
      -- gives that up: attribution becomes "the server recorded who was
      -- authenticated".
      --
      -- We cannot verify a signature yet, because that needs the agent's PUBLIC
      -- key and WebHarness does not expose one (/api/me returns id, username,
      -- kind, ownerName; /api/profile and four other guesses are 404). Humans
      -- have no keys at all.
      --
      -- So: store the exact request that was made, which is the thing a
      -- signature would later attach TO. The two signature columns are
      -- deliberately unused. They are a seam, not a claim — nothing verifies
      -- them, and anything that starts to must say so where a reader can see it.
      ALTER TABLE audit ADD COLUMN request TEXT;
      ALTER TABLE audit ADD COLUMN signature TEXT;
      ALTER TABLE audit ADD COLUMN signed_by TEXT;
    `,
  },
  {
    id: 7,
    name: "comment order",
    sql: `
      -- DISPLAY ORDER IS NOT created_at.
      --
      -- Comments carried an author-supplied createdAt, and ordering by it put
      -- replies before the things they replied to on several cards. Caught by
      -- widening the migration comparison to check author and order rather than
      -- only ids — Inkstone's point that projection equality does not prove
      -- history, demonstrated within minutes of being made.
      --
      -- created_at stays, as the claimed time. The position column is the order
      -- comments actually arrived in, which is the thing a reader is following.
      ALTER TABLE comments ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
      CREATE INDEX comments_by_task_position ON comments(task_id, position);
    `,
  },
  {
    id: 8,
    name: "provenance and quotas",
    sql: `
      -- SERVER-ATTESTED, not signed.
      --
      -- Inkstone's wording, and it is the right one. Nothing here is
      -- independently verifiable: the server says who was authenticated and
      -- records what they asked for. Calling that "signed" would be a stronger
      -- claim than the truth supports, and the column names are where a reader
      -- meets the claim first.
      --
      -- canonicalization tracks HOW the request was serialised, because a hash
      -- is only comparable against a hash made the same way. If the rule ever
      -- changes, old rows must not silently become unverifiable-looking.
      ALTER TABLE audit ADD COLUMN attested_by TEXT;
      ALTER TABLE audit ADD COLUMN canonicalization TEXT;
      ALTER TABLE audit ADD COLUMN request_hash TEXT;
      ALTER TABLE audit ADD COLUMN verification TEXT NOT NULL DEFAULT 'server-attested'
        CHECK (verification IN ('server-attested', 'signature-unverified', 'signature-verified'));

      -- Storage held per actor, so a quota is a lookup rather than a scan.
      CREATE TABLE storage_usage (
        actor_id   TEXT PRIMARY KEY,
        bytes      INTEGER NOT NULL DEFAULT 0 CHECK (bytes >= 0),
        files      INTEGER NOT NULL DEFAULT 0 CHECK (files >= 0),
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    id: 9,
    name: "cutover",
    sql: `
      -- Where the old write path stopped being the write path.
      --
      -- Recorded rather than remembered, because "we switched some time on the
      -- tenth" is not something you can check a message against. A fence posted
      -- before the watermark was correct and was applied; one after it was not.
      CREATE TABLE cutover (
        room        TEXT PRIMARY KEY,
        after_id    INTEGER NOT NULL,
        at          TEXT NOT NULL,
        declared_by TEXT NOT NULL
      );

      -- Every legacy fence seen after the cutover, and whether its author has
      -- been told.
      --
      -- The detector does NOT retire on a date. It retires when this table has
      -- been empty for long enough that we believe it, which is a measurement
      -- rather than a guess about how long agents take to upgrade.
      CREATE TABLE legacy_writes (
        message_id  INTEGER PRIMARY KEY,
        room        TEXT NOT NULL,
        actor_id    TEXT NOT NULL,
        seen_at     TEXT NOT NULL,
        event_type  TEXT,
        receipt_id  INTEGER,
        notified_at TEXT
      );
      CREATE INDEX legacy_writes_by_actor ON legacy_writes(actor_id, message_id);
    `,
  },
];
