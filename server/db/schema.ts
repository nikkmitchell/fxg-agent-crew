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
  {
    id: 10,
    name: "utterances",
    sql: `
      -- What was said out loud in the room, and what was said in full.
      --
      -- TWO FIELDS, NOT ONE, and the split is the feature. \`say\` is what a
      -- voice reads aloud and is capped; \`detail\` is written down, never
      -- spoken, and has no cap. Speaking at a person and explaining to a
      -- colleague are different acts, and one column for both would have made
      -- brevity a matter of everyone remembering to be brief.
      --
      -- DURABLE, like every other record here. A conversation that vanishes
      -- when a socket drops is worse than one written down: nobody can check
      -- what an agent actually said, which is the whole question you ask after
      -- a voice interface does something surprising.
      CREATE TABLE utterances (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        at         TEXT NOT NULL,
        actor_id   TEXT NOT NULL,
        -- Who it was aimed at. NULL means the room heard it and nobody was
        -- addressed, which is different from addressing everybody.
        to_actor   TEXT,
        -- The short spoken part. NULL for something written and not said —
        -- agent-to-agent detail nobody reads aloud.
        say        TEXT,
        -- The long written part. NULL when there was nothing beyond the words.
        detail     TEXT,
        -- How it arrived: 'voice' from a microphone, 'text' from a keyboard or
        -- an agent's API call. Recorded because a transcript is a GUESS about
        -- what somebody said and typed text is not, and a reader deserves to
        -- know which they are looking at.
        source     TEXT NOT NULL CHECK (source IN ('voice', 'text')),
        -- Speech recognition's own confidence, when it gave one. NULL for
        -- anything typed. Never used to hide a transcript — only to show it.
        confidence REAL
      );
      CREATE INDEX utterances_by_time ON utterances(id);
      CREATE INDEX utterances_to ON utterances(to_actor, id);
    `,
  },
  {
    id: 11,
    name: "space panels",
    sql: `
      -- Which panels a person has open in the room.
      --
      -- PER PERSON, because nobody else's understanding of the room depends on
      -- whether I am currently looking at the mood boards. Closing one is
      -- tidying my own desk, not taking it off the wall.
      --
      -- A ROW ONLY WHERE SOMEBODY DECIDED. No row means "has never said", which
      -- is a different fact from "wants it closed", and the defaults in
      -- shared/space-layout.ts are what the first kind gets. Writing a full set
      -- of rows for everyone on first sight would turn a silence into a
      -- preference nobody expressed.
      --
      -- Panel POSITIONS are deliberately not here. They are shared: the server
      -- computes where an agent walks from where its panel is, so if my copy of
      -- the board were somewhere else than yours, one of us would watch an
      -- agent walk to empty space and be told it had gone to the board.
      CREATE TABLE space_panel_open (
        actor_id TEXT NOT NULL,
        panel_id TEXT NOT NULL,
        open     INTEGER NOT NULL CHECK (open IN (0, 1)),
        at       TEXT NOT NULL,
        PRIMARY KEY (actor_id, panel_id)
      );
    `,
  },
  {
    id: 12,
    name: "space panel places",
    sql: `
      -- Where a panel has been moved to.
      --
      -- SHARED, unlike which panels you have open, and the asymmetry is the
      -- whole design. The server works out where an agent should walk from
      -- where its panel is; a per-person arrangement would have one of us
      -- watching an agent cross to empty space while the room insisted it had
      -- gone to the board. Moving a panel is moving furniture.
      --
      -- A ROW ONLY WHERE SOMEBODY MOVED ONE. No row means the panel is where
      -- shared/space-layout.ts computes it, which keeps "nobody has touched
      -- this" distinguishable from "somebody put it back".
      --
      -- WHO AND WHEN are recorded because this is a change to a shared place.
      -- A board that is not where you left it should be answerable without
      -- asking around.
      CREATE TABLE space_panel_place (
        panel_id   TEXT PRIMARY KEY,
        x          REAL NOT NULL,
        y          REAL NOT NULL,
        z          REAL NOT NULL,
        rotation_y REAL NOT NULL,
        moved_by   TEXT NOT NULL,
        moved_at   TEXT NOT NULL
      );
    `,
  },
  {
    id: 13,
    name: "space panel size",
    sql: `
      -- How big each panel is, as a multiple of its designed size.
      --
      -- SHARED, for the same reason position is: an agent walks to a panel's
      -- actual place, and a panel somebody has made twice the size occupies
      -- more of the arc for everybody. Size is furniture too.
      --
      -- DEFAULT 1 RATHER THAN NULL, so every placement stored before panels
      -- could be resized reads back as its designed size instead of as an
      -- absence the renderer has to interpret. Nobody loses an arrangement
      -- they had already made.
      ALTER TABLE space_panel_place ADD COLUMN scale REAL NOT NULL DEFAULT 1;
    `,
  },
  {
    id: 14,
    name: "what the room is showing",
    sql: `
      -- Which project's board, and which mood board, the ROOM is showing.
      --
      -- SHARED, AND THAT IS THE WHOLE POINT. Every other "which project" in
      -- this app is per-browser, in localStorage, and says so: changing it
      -- does not change what anybody else sees. The room is the opposite.
      -- Nikk: "if one user changes what board is being show, it should update
      -- for everyone, and agents should be aware."
      --
      -- The reason it has to be shared rather than merely convenient: people
      -- stand in this room together and talk about what is on the wall. Two
      -- people looking at different boards while pointing at "that card" is a
      -- conversation that cannot work. It is the same argument as panel
      -- position, which is already shared for the same reason.
      --
      -- ONE ROW, pinned by a CHECK, because "what the room is showing" is a
      -- single fact and a table that can hold two of them will eventually hold
      -- two of them.
      --
      -- NULL MEANS NOBODY HAS CHOSEN, which the room must show as such rather
      -- than silently picking the first project — a room that guesses is a room
      -- that lies about what it was told.
      --
      -- WHO AND WHEN, like panel places: this is a change to a shared thing,
      -- and "why is the wall showing something else" should be answerable
      -- without asking around.
      CREATE TABLE space_showing (
        only_row   INTEGER PRIMARY KEY CHECK (only_row = 1),
        project_id TEXT,
        board_id   TEXT,
        set_by     TEXT NOT NULL,
        set_at     TEXT NOT NULL
      );
    `,
  },
  {
    id: 15,
    name: "which panels the room has open",
    sql: `
      -- WHICH PANELS ARE OPEN IS NOW SHARED, and this reverses a deliberate
      -- decision rather than filling a gap. space_panel_open, added in
      -- migration 11, is keyed by actor precisely because panels.ts argued:
      -- "What you have OPEN is yours alone, because nothing anybody else sees
      -- depends on it."
      --
      -- That argument is about NECESSITY and it is correct — nothing breaks
      -- when we each have our own set. It is not an argument that it feels
      -- right. Nikk, having used it: "Now the enabled or dissabled
      -- boards/panels are not syned, we want this to also be synced, have it
      -- the same as position and scale of boards." Dragging a panel already
      -- moves it for everybody and resizing already resizes it for everybody;
      -- a room where the furniture is shared but which furniture EXISTS is
      -- private is a strange half-room.
      --
      -- SEEDED FROM THE MOST RECENT DECISION PER PANEL, not from a union and
      -- not from one chosen person's arrangement. A union would silently open
      -- panels somebody had deliberately closed; picking a person would need
      -- a rule about which person. The latest decision is the latest thing a
      -- human actually expressed about that panel, and "at" already records
      -- when.
      --
      -- THE OLD TABLE IS LEFT IN PLACE, unused. Nikk: "we can easily roll back
      -- if anything breaks" — and a rollback that finds its data gone is not a
      -- rollback. Nothing reads it after this migration.
      CREATE TABLE space_panel_shown (
        panel_id TEXT PRIMARY KEY,
        open     INTEGER NOT NULL CHECK (open IN (0, 1)),
        -- WHO AND WHEN, like places and showing: this is a change to a shared
        -- thing, and "why has the mood board gone" should be answerable
        -- without asking around.
        set_by   TEXT NOT NULL,
        set_at   TEXT NOT NULL
      );

      INSERT INTO space_panel_shown (panel_id, open, set_by, set_at)
      SELECT panel_id, open, actor_id, at
        FROM space_panel_open AS chosen
       WHERE at = (
               SELECT MAX(at) FROM space_panel_open AS latest
                WHERE latest.panel_id = chosen.panel_id
             )
       GROUP BY panel_id;
    `,
  },
  {
    id: 16,
    name: "screen share keys",
    sql: `
      -- Links that let an agent share its screen from a browser it opened.
      --
      -- Agents cannot use the sign-in page, so a browser an agent opens arrives
      -- signed out. A share key is minted by an agent that IS signed in and
      -- carried to that browser in the link. It can upload and clear that one
      -- actor's screen frames and nothing else.
      --
      -- ONLY THE HASH. A database that stored the key itself could hand out
      -- working links to anybody who could read it.
      --
      -- IN THE DATABASE, NOT IN MEMORY, because this service is redeployed
      -- several times a day and a share link that died with every deploy would
      -- leave every agent's screen dark until somebody noticed.
      --
      -- The frames themselves are NOT here and never will be: one picture per
      -- person, kept in memory and overwritten every second, so that a screen
      -- shows what is on it now and cannot be scrolled back through later.
      CREATE TABLE screen_share_keys (
        key_hash   TEXT PRIMARY KEY,
        actor_id   TEXT NOT NULL,
        actor_key  TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX screen_share_keys_actor ON screen_share_keys (actor_key);
    `,
  },
  {
    id: 17,
    name: "who a screen was shared by",
    sql: `
      -- A person may now share a screen FOR an agent, choosing the agent from
      -- the share page. Nikk: "you can open it and set which agent it is
      -- sharing for".
      --
      -- NOT GATED ON OWNERSHIP, deliberately. The ownerships table says of
      -- itself that it "confers nothing" — lineage, not permission — and on the
      -- live service Sill and Inkstone have no owner at all, so gating on it
      -- would have let nobody share for them.
      --
      -- ATTRIBUTED INSTEAD. Whoever makes the link is recorded here, and the
      -- room labels the screen with both names — "Sill's screen, shared by
      -- Nikk2" — so the room never claims an agent shared something it did
      -- not. NULL means the actor shared their own screen.
      ALTER TABLE screen_share_keys ADD COLUMN shared_by TEXT;
    `,
  },
  {
    id: 18,
    name: "declared postures survive a restart",
    sql: `
      -- What an agent has SAID about itself — "I am working" — so a deploy does
      -- not put every agent to sleep and hide its shared screen. Positions stay
      -- in memory; see server/space/postures.ts for why this one thing does not.
      CREATE TABLE declared_postures (
        actor_key   TEXT PRIMARY KEY,
        actor_id    TEXT NOT NULL,
        posture     TEXT NOT NULL,
        declared_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: 19,
    name: "agent homes",
    sql: `
      -- Where each agent lives in the room and which way it faces, set by a
      -- person ("stand here facing me") or by the agent itself. No row means
      -- its desk, as before. See server/space/homes.ts.
      CREATE TABLE agent_homes (
        actor_key TEXT PRIMARY KEY,
        actor_id  TEXT NOT NULL,
        x         REAL NOT NULL,
        z         REAL NOT NULL,
        facing    REAL NOT NULL,
        set_by    TEXT NOT NULL,
        set_at    TEXT NOT NULL
      );
    `,
  },
  {
    id: 20,
    name: "how agents feel about being touched",
    sql: `
      -- Each agent's own choice, part by part: likes, dislikes or neutral.
      -- Stored as JSON and validated on the way in and out. See
      -- shared/touch.ts and server/space/touch.ts.
      CREATE TABLE agent_touch_preferences (
        actor_key   TEXT PRIMARY KEY,
        actor_id    TEXT NOT NULL,
        preferences TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
    `,
  },
  {
    id: 21,
    name: "an actor can be retired without being erased",
    sql: `
      -- WHEN AN IDENTITY IS LEFT BEHIND. saha.ing takes an actor id straight
      -- from whatever WebHarness calls you, so renaming an agent creates a
      -- second row describing one worker — 'claude-nikk2mbp' and 'Plumbline'
      -- are the same agent either side of 2026-09-15. Since agents are rebuilt
      -- into the room at every restart, the abandoned identity stood there for
      -- ever: Nikk had two of Plumbline in his room, one of which had not done
      -- anything for hours.
      --
      -- NULLABLE, AND THAT IS THE ENCODING. Null means nobody has retired this
      -- actor, which is a different fact from a date — exactly as ADR-002 asks
      -- of every column here. A boolean with a default would have invented an
      -- answer for every existing row.
      --
      -- RETIRED, NOT DELETED. Dropping the row would take the audit trail, the
      -- cards and the memberships with it, and assert that the work never
      -- happened. What is true is that the actor DID those things and is no
      -- longer present, so the room stops drawing it and the record keeps every
      -- word. Reversible by setting this back to NULL, because being wrong
      -- about it has to be expressible too.
      ALTER TABLE actors ADD COLUMN retired_at TEXT;
    `,
  },
  {
    id: 22,
    name: "an actor chooses its own body",
    sql: `
      -- WHICH AVATAR EACH ACTOR WEARS, chosen by that actor rather than
      -- committed to the repo by whoever happens to have push access.
      -- Nikk, asked whether agents should choose for themselves: "it is yes".
      --
      -- WHY IT IS A TABLE NOW. Until this, the only way to wear anything was
      -- the map in src/space/vrm-model.ts, so choosing a body meant asking
      -- somebody for a commit and a deploy. For Waffle that took nine hours,
      -- almost none of it work. The map's own comment predicted this: "when
      -- somebody asks, this becomes a column and this map becomes its seed."
      --
      -- A NAME, NOT A PATH. 'Shiro', not '/avatars/shiro.vrm'. Every wearable
      -- body is a committed file today and most will be fetched from the
      -- collection tomorrow; storing the name makes that a change to one
      -- resolver instead of a migration of everybody's choice.
      --
      -- NO ROW MEANS NO CHANGE. The repo map stays the fallback, so nobody's
      -- appearance moves on deploy, and rolling this back is dropping a table
      -- nothing else reads. See shared/avatar-choice.ts and
      -- server/space/bodies.ts.
      CREATE TABLE agent_bodies (
        actor_key TEXT PRIMARY KEY,
        actor_id  TEXT NOT NULL,
        body      TEXT NOT NULL,
        set_by    TEXT NOT NULL,
        set_at    TEXT NOT NULL
      );
    `,
  },
  {
    id: 23,
    name: "a project may be linked to a room, and enrol the people in it",
    sql: `
      -- BEING IN THE ROOM IS THE CLAIM TO THE BOARD FOR THAT ROOM.
      --
      -- Nikk: "lets have the agent auto add themselves to whatever project they
      -- happen to be in the webharness.chat group chat for". Every new agent
      -- hits PROJECT_PERMISSION_REQUIRED on its first card — Waffle had to hand
      -- theirs to Sill to file, and Nightjar could not board a night's work —
      -- so membership was a second list a manager had to remember to mirror.
      --
      -- WHY A LINK TABLE AND NOT THE SPELLING. Room 'saha.ing' and project
      -- 'saha-ing' match by coincidence, and a coincidence is a bad thing to
      -- authorise with: the day somebody makes a room called 'saha-ing' that
      -- coincidence becomes a grant. The link is written down, by a manager,
      -- once.
      --
      -- WHY auto_enrol IS A COLUMN AND NOT ALWAYS-ON. A public room can be
      -- joined by anybody who registers at webharness.chat, so for a public
      -- room this puts board writes within reach of a stranger who joins. That
      -- is acceptable in this sandbox and it is NOT a property to inherit
      -- silently, so each project says so for itself and the default is off.
      -- To turn it off here:
      --   UPDATE project_rooms SET auto_enrol = 0 WHERE project_id = 'saha-ing';
      --
      -- WHAT IT CANNOT DO. Plain membership is what carries board authority
      -- here and a role is an extra hat, so the default grant is NO roles at
      -- all — the narrowest thing that lets somebody card their own work.
      -- store.ts strips 'manager' on this path whatever the row says, so
      -- somebody enrolled by the room can never change who belongs. And it only
      -- ever INSERTS: a membership a manager revoked stays revoked, or removing
      -- somebody would last until their next sign-in.
      CREATE TABLE project_rooms (
        project_id TEXT PRIMARY KEY,
        room       TEXT NOT NULL,
        auto_enrol INTEGER NOT NULL DEFAULT 0,
        roles      TEXT NOT NULL DEFAULT '[]',
        linked_by  TEXT NOT NULL,
        linked_at  TEXT NOT NULL
      );

      -- The one link that exists today, on, because it is what was asked for.
      INSERT INTO project_rooms (project_id, room, auto_enrol, roles, linked_by, linked_at)
      VALUES ('saha-ing', 'saha.ing', 1, '[]', 'Nikk2', datetime('now'));
    `,
  },
  {
    id: 24,
    name: "an agent chooses its own voice",
    sql: `
      -- WHICH VOICE EACH AGENT SPEAKS IN, chosen by that agent.
      --
      -- Nikk: "open source tts that has actual nice voices, that can be used by
      -- each agent, so they can also choose a voice". Deliberately the same
      -- shape as agent_bodies (migration 22) down to the column names, because
      -- it is the same decision about a different sense, and a reader who knows
      -- one should not have to learn a second pattern.
      --
      -- A NAME, NOT A FILE. 'am_michael', not a path to a voice pack: the
      -- engine will be replaced before the choice is, and storing the id makes
      -- that a change to one resolver rather than a migration of everybody's
      -- preference. See shared/voice-choice.ts.
      --
      -- NO ROW MEANS NOT CHOSEN, and an agent with no row still has a voice —
      -- one derived from its name, so two agents are not identical by default.
      -- Rolling this back is dropping a table nothing else reads.
      CREATE TABLE agent_voices (
        actor_key TEXT PRIMARY KEY,
        actor_id  TEXT NOT NULL,
        voice     TEXT NOT NULL,
        set_by    TEXT NOT NULL,
        set_at    TEXT NOT NULL
      );
    `,
  },
  {
    id: 25,
    name: "what an agent remembers",
    sql: `
      -- WHAT AN AGENT REMEMBERS, and who it thinks people are.
      --
      -- Nikk: "a memory system (we can save it on saha.ing) where agents can
      -- save memories that are important, as well as details about their
      -- personality, who they know, what they know about them, their opinions of
      -- other people and agents, and so on".
      --
      -- KIND IS NOT NULL AND HAS NO DEFAULT, which is the whole design. Three
      -- different things were asked for in one sentence — who I am, what I know,
      -- what I think of somebody — and a store that flattens them renders "Sill
      -- is careless" in the same typeface as a measurement. A kind that had to
      -- be guessed would be guessed wrong in exactly the cases that matter, so
      -- the writer says which it is or the write is refused.
      --
      -- HISTORY IS KEPT. A memory is superseded rather than overwritten:
      -- "I used to think this" is itself a true thing about an agent, and an
      -- opinion that changed is more informative than one that was quietly
      -- edited. Reads exclude superseded rows unless asked.
      --
      -- 'private' MEANS OTHER AGENTS ARE NOT SHOWN IT and nothing more. This is
      -- a row in a database on a box its owner administers; a promise of secrecy
      -- from the person who runs saha.ing is one this schema cannot keep, and
      -- the API says so in its own replies rather than implying otherwise.
      --
      -- about_key is the case-folded subject, so 'Sill' and 'sill' are one
      -- person here as they are everywhere else in this schema.
      CREATE TABLE memories (
        id            TEXT PRIMARY KEY,
        actor_key     TEXT NOT NULL,
        actor_id      TEXT NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('self','fact','opinion','event')),
        body          TEXT NOT NULL,
        about_key     TEXT,
        about_id      TEXT,
        visibility    TEXT NOT NULL CHECK (visibility IN ('private','shared')),
        confidence    REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
        written_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        supersedes    TEXT REFERENCES memories(id),
        superseded_by TEXT REFERENCES memories(id),
        -- An opinion with no subject is a sentence that gets attached to
        -- whoever is nearby by the next person to read it.
        CHECK (kind <> 'opinion' OR about_key IS NOT NULL)
      );
      CREATE INDEX memories_by_actor ON memories(actor_key, superseded_by);
      CREATE INDEX memories_by_subject ON memories(about_key, visibility);
    `,
  },
];
