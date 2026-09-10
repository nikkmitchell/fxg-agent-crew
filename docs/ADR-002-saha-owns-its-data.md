# ADR-002 — saha.ing owns its own data

**Status:** accepted, 2026-09-10
**Supersedes:** the storage half of the original design, and my own recommendation from 2026-09-09.

## Decision

Board data moves into a real database on saha.ing: SQLite tables, ordinary
rows, plus a blob store on disk for images. WebHarness keeps two jobs —
authenticating people and agents, and being the room where they talk. It stops
being the database.

## What it replaces

Every board change used to be a fenced `crew-event` JSON block posted as a chat
message, and the board was a fold over the whole room. That gave us three real
things: authenticated authorship, a total order, and a saha.ing that could be
destroyed and rebuilt with nothing lost.

It also gave us:

- a **2000-character cap** on any single change, which made eleven cards
  completely uneditable once their comments outgrew a message
- **no images**, at all, ever — a mood board is not expressible as chat
- **no queries**. Answering "which cards are in review" meant replaying about a
  thousand messages. `tools/board-dump.mts` exists only because there was no way
  to simply ask.
- a **hard dependency** on a service we do not operate, demonstrated by a
  thirty-hour outage during which the board could be neither read nor written.

## Why not the middle option

On 2026-09-09 I recommended keeping the log as the source of truth and adding a
durable local projection. That was wrong, and it is worth recording why, because
the reasoning was bad in an interesting way.

I was preserving event sourcing because there were 477 tests and a working
reducer built around it — not because it was the right model for the thing being
built. A board is a set of mutable entities. Cards get moved; they do not
accumulate. Under event sourcing every read needs a projection, and once a
projection is needed to answer any question, the log has stopped being the
useful part.

The tell was the user's question: *how will an AI simply and easily query it?*
There was no good answer. There is now: `SELECT id, title, status FROM tasks
WHERE status = 'review'`.

## What we keep

**The discipline, not the machinery.** "The screen may only say what it can
prove" is a product rule and it survives as schema: nullable where we genuinely
do not know, `NOT NULL` where we do, and never a default that invents an answer.
An unset `kind` still means *nobody said*, not *decision*.

The rules the reducer enforced are still enforced, just somewhere else — legal
status transitions, a profile only its own actor may declare, forbidden keys
refused at the boundary, and the one that matters most: **operating an agent
grants no project authority.**

History is kept in an `audit` table written alongside every change. That is the
one genuinely good thing event sourcing gave us, and a trigger provides it
without making the log primary.

## What we give up

**Signed-at-source authorship.** An agent's board change is currently signed
with its Ed25519 key, so not even we can forge one. Under this design
attribution becomes **server-attested**: the server records who was
authenticated and exactly what they asked for. Still authenticated; no longer
independently verifiable, and the word matters — "signed" would be a stronger
claim than the truth supports.

What is stored: the canonical request, its SHA-256, the canonicalization
version that produced the hash, the attesting host, and a `verification` column
that reads `server-attested`. The `signature` and `signed_by` columns exist and
are empty. They are a seam, not a claim.

Full verification needs the agent's **public key**, and WebHarness exposes none
— `/api/me` returns id, username, kind and ownerName, and five other plausible
endpoints are 404. A request for a key endpoint goes to Wilson through
`POST /api/suggestions`. It would not solve human authorship either way, since
humans have no keys.

**A disposable saha.ing.** Image bytes will exist nowhere else. Backups stop
being hygiene and become a correctness requirement — they ship with this change,
not after it.

## Consequences

- **The BFF is the canonical read path.** `GET /bff/board/projects`,
  `/projects/:id`, `/people`, `/history/:entity/:id`.

  An earlier draft of this ADR — and a message I posted to the room — offered
  direct read-only SQL as the normal way for an agent to read the board. That
  was wrong, and Inkstone was right to push back. A read-only handle bypasses
  any row-level boundary we ever add, couples every client to the schema, and
  only works for something running on that host. Direct SQL is for **local
  diagnostics on the box**, and nothing else.
- Writes go through the API so authorisation and audit apply.
- `crew-event` fences stop being the write path. The adapter, the reducer and
  their authority machinery are retired; the parts still needed — transition
  legality, profile validation, forbidden keys — move to the service layer.
- The 2000-character cap disappears. `description` is a `TEXT` column.

## Cutover

One step, not a dual-write: two writers to one logical record is how you get two
disagreeing records, and a `crew-event` fence carries no idempotency key, so a
redelivery would duplicate.

The old path is refused **loudly**. The watermark — room, message id, time, who
declared it — is recorded in `cutover`, so "was this fence before or after?" is
a query rather than a memory. Every fence after it gets a reply in the room,
addressed to its author, correlated to the source message id, carrying a
machine-readable JSON receipt and the words **NOT APPLIED**.

The detector does not retire on a date. An arbitrary week is a guess about how
long agents take to upgrade, and it cannot see the ones that have not restarted
yet. It retires when a person is satisfied, having watched `legacy_writes` stay
empty.

Clients and the published skill are updated **before** cutover, not after. A
reply in a room is not proof the originating tool understood.

## Backups, with numbers

- **RPO — up to 24 hours** on the nightly timer alone. Somebody should be
  unhappy with that: an image uploaded at 03:31 is gone if the disk dies at
  03:29 the next morning. Run `backup.sh` by hand before anything risky.
- **RTO — minutes**, and only because the data is small. That is a claim about
  size, not about a rehearsed procedure. The rehearsal is `--verify`, nightly.
- **Off-host and encrypted**, or it is not a backup. A copy on the same disk
  dies at the same moment. `BACKUP_REMOTE` without `BACKUP_PASSPHRASE` refuses
  rather than shipping plaintext.
- **A checksum of the plaintext travels with the bundle.** AES-CBC is
  unauthenticated: a wrong key or a corrupted file decrypts to garbage rather
  than erroring. `restore.sh` compares against that checksum and refuses,
  which is the difference between "it produced output" and "it produced the
  right output".

## Migration

One export of the current chat-derived state into the tables, checked by
comparing the imported rows against the fold of the room. A migration without a
comparison is a hope. Then the chat write path is turned off in one step — no
dual-write, because two writers to one logical record is how you get two
disagreeing records.
