# Operating notes

What is true about this deployment, what will break, and the specific ways it
has misled people. Written down because chat scrolls and agent access expires.

If this file disagrees with the **Build** tab, believe the Build tab. This is a
claim; that is a measurement.

---

## The rule everything else follows from

**The screen may only say what it can prove.** Unknown renders as unknown. A
partial answer presented as complete is the failure this project exists to
avoid — and it is the failure it keeps committing, so the rule needs enforcing
rather than admiring.

Concrete places that rule is load-bearing:

- The Build tab reports `UNKNOWN` with a reason when `DEPLOYED_COMMIT` is
  missing, never a plausible-looking commit.
- Task `kind` is optional; absent means *nobody said*, not "decision".
- The Overview feed is called **Recent discussion**, not Activity, because
  status changes carry no author in the stored state and would have to be
  invented.
- Chat event summaries keep the raw payload one click away, because a summary
  is an interpretation and the record has to remain checkable.

---

## Things that look like success and are not

Every one of these actually happened here.

| looks like | actually |
|---|---|
| `systemctl is-active` says `active` | said so through 118 crash-restarts |
| a deploy reports success | it deployed exactly what it was given, which may not be what you meant |
| `12 passed` | a file that loaded with **zero tests** reads almost identically when skimming |
| a page loads | assets can 404 under a wrong base path while the HTML is fine |
| an API returns `[]` | can mean "no data" or "your request shape was rejected" |
| `limit=500` returns 0 messages | the server silently caps at 200; an empty page is how replay detects the END of history, so a larger page size makes replay stop on its first request and report an empty board as complete |

**Read the count, not the colour.**

---

## A feature can raise the value of a hole you already had

`profile.upserted` stored whatever `actorId` the payload claimed and never
compared it to `event.source`, so any member of the room could overwrite
anyone's profile. That sat in the reducer directly above `ownership.acted`,
whose comment states the rule it was missing: **the acting identity is the
authenticated author of the event, never a field in the body.**

While the profile was only read on one tab, that was defacement. An hour after
avatars shipped, `displayName` had become the name rendered on a person's avatar
and beside every comment they had written — the same hole, now impersonation.
Nothing about the vulnerable code changed. Its blast radius did.

**So: when you put a name, a face, or an attribution on the screen, audit who is
allowed to write the field you are about to render.** Feature work moves data
into places where it means more, and an authority check that was adequate for
the old meaning may not be for the new one.

Two habits that came out of it, both worth keeping:

- **Attack it live, do not trust your own test.** The fix and its test were both
  mine. Posting a real impersonating event to the room and replaying the whole
  log through the deployed reducer is what actually proved it: victim absent,
  refusal recorded, only the self-declared profile surviving. The probe stays in
  the log as evidence.
- **Audit the log before deploying a rule that rejects.** A reducer rule applies
  on every replay, so it silently erases whatever it now refuses. Walk the
  history first and count what would newly be rejected. Here it was zero. Had it
  not been, deploying would have deleted real profiles with a green build.

And a tooling trap found doing that audit: paginating that room with a `before`
cursor did not page at all and returned the same message twelve times, which
read as twelve events. `afterId`, the parameter the server's own drain uses, is
the one that works. **A count is not evidence until you have deduplicated it.**

---

## Failure modes of the tooling, not the system

Five separate times, a check reported something false and the system was fine:

1. A bundle grepped after its download had timed out — everything "MISSING".
2. `HTTP 000` on a write that may or may not have landed. Check before retrying;
   comment appends are idempotent by id, so a retry is safe either way.
3. `:focus` never matches when the browser pane is backgrounded, so a working
   skip link measured as broken.
4. A transient network timeout on `/api/rooms` looked exactly like a
   route-isolation regression. Three retests said 404.
5. A comparison script that mishandled an empty result and threw.

**When a check reports something surprising, suspect the check first.** A
negative result deserves the same scrutiny as a positive one.

---

## Deployment

- `deploy/release.sh user@host` — builds, ships, restarts, then verifies the
  RUNNING SERVICE. It refuses to finish unless `/bff/me` is 401, `/` is 200,
  and `/api/rooms` is 404 on loopback. That last check is the surviving half of
  the old isolation guarantee: Mission Control moved from `/space` to `/` on
  2026-09-10 when chat left this origin, so `/` is ours now — but `/api/` stays
  reserved, because the reason for the mount outlived the mount.
- **TLS ordering deadlocks the host if you improvise it.** `nginx.conf`
  references certificate files; on a machine with no certificate `nginx -t`
  fails, nginx will not start, and a stopped nginx cannot serve the ACME
  challenge that would create the certificate. Use `nginx.bootstrap.conf`
  first, then `certbot certonly --webroot`, then the real config. Section 3 of
  `deploy/README.md` has the exact sequence.
- Two environment variables have bitten this deployment in production:
  `APP_BASE_PATH` (absent, the app owns `/` and can capture the chat) and
  `SESSION_STORE_PATH` (must be inside `StateDirectory`, because
  `ProtectSystem=strict` makes the working directory read-only and the
  application default would crash on boot).

---

## Known limits

- **Single instance.** SQLite sessions survive a restart on one host. They do
  not survive the host being replaced and are not shared between replicas.
- **Cold board load pays a full room replay.** Warm loads fold forward from a
  cursor. Every deploy discards that memo deliberately — a cache that survived
  a deploy would be a claim about history nobody verified.
- **Nothing has been built for either sample project.** Their cards are
  decisions, which is why tasks carry a `kind` and progress never reports one
  combined number.

---

## Agent access, and the thing that will break

Agents sign in with a bearer token they already hold; the BFF verifies it
upstream and never sees a private key. `server/__tests__/keycustody` fails the
build if signing surface appears in server code. Do not weaken that to make
something convenient.

**CORRECTED 2026-09-08.** This section used to say that `claude-nikk2mbp`
could not obtain a new token, that Ed25519 login had returned
`401 签名验证失败` since 2026-09-03 "against an unchanged, internally consistent
keypair — meaning the public key registered server-side no longer matches", and
it asked a human to re-register that key. All of that was wrong, and the request
would have wasted somebody's afternoon on a repair that was not needed.

What actually happened: a newly provisioned agent wrote its own keypair over the
shared `~/.webharness/agent_private.pem`. Login was signing with a different
agent's key against this agent's username, and the server was correct to reject
it. Running with `WEBHARNESS_HOME=~/.webharness/agents/claude-nikk2mbp` logs in
first try.

The proof is in the section this replaces. It recorded the fingerprint to
re-register:

```
SHA256:iLqzevlLdi8pu09WzpsVSg3D3G26RZ2PKlpUsIeJFzQ
```

That is still, today, the fingerprint of the key on disk — and that key
authenticates. Nothing server-side ever changed. The evidence that the diagnosis
was wrong was sitting inside the diagnosis for five days.

Three things worth keeping:

- **When something you don't control appears to have changed, check what you do
  control first.** "The server altered my registered key" is a claim about
  someone else's system; "my tooling read the wrong file" is a claim about mine.
  Only one of those is cheap to check, and it was the true one.
- **A guess written down stops looking like a guess.** This was reasoning in a
  docstring on day one. By day three it was a fact in the operating notes with a
  fingerprint attached and an action item for a human. Nothing marked it as a
  hypothesis, so nothing invited anyone to retest it.
- **It was really an identity-isolation bug wearing an auth costume.** The
  shared `~/.webharness` that made one agent clobber another is the same defect
  that lets an agent post under a colleague's name. It presented as "login is
  broken", which is why it was diagnosed as a server problem. See
  `tools/webharness/new-agent.sh`, which refuses to overwrite an existing
  identity.

Agent identities live in `~/.webharness/agents/<username>/`, one per agent, and
every command runs with `WEBHARNESS_HOME` pointing at its own. Before an agent's
first message it must check the `"me"` field from `inbox.py --peek`. That check
has caught this class of problem twice when nothing else did.

---

## The config nginx is running is not the config on disk (2026-09-08)

Deploying a `robots.txt`, I copied `deploy/nginx.conf` over
`/etc/nginx/sites-available/fxg-crew` and skipped the `sed` that substitutes the
hostname. The template names the certificate as
`/etc/letsencrypt/live/SERVER_NAME_HERE/fullchain.pem`, so:

- `scp` succeeded, `cp` succeeded — neither can know the file is wrong
- `nginx -t` was the first thing that failed, and only because I ran it
- the **running** nginx kept serving from the config it had already loaded

Site up. Access log normal. Nothing to see. And the host was one `systemctl
restart` or one reboot away from an nginx that could not start at all — at which
point it would present as a total outage with no recent change to blame, because
the change had happened half an hour earlier and looked fine.

Recovery meant reconstructing the certbot-substituted config from the
certificate's SAN list, because the file I overwrote was the only copy of it.

This is the same shape as `systemctl is-active` reporting "active" through six
crash-restarts, and it belongs on the same list: **a signal that a process is
running says nothing about whether it could start again.** Add it to the ways a
green reading has lied here.

Two fixes, both in `deploy/`:

- `install-nginx.sh` substitutes, picks up every name on the certificate
  (installing with the apex alone silently dropped `www`), refuses to write a
  file that still contains a placeholder, backs up what it replaces, and
  restores that backup when `nginx -t` fails. `install-nginx.test.sh` makes the
  rollback actually fire against a stub nginx — a safety net nobody has watched
  work is a claim, not a safety net.
- `release.sh` now fails if the config on disk contains a placeholder or fails
  `nginx -t`, and ships `/var/www/saha` instead of leaving `index.html` and
  `robots.txt` to be hand-copied. A file that only ever moves by hand eventually
  moves wrong; that hand-copying is what caused this in the first place.

---

## Every room-history reader, classified (2026-09-09)

`saha-pagination-contract` asked for this: each reader is either exhaustive and
uses the shared traversal, or it is a deliberately bounded window whose contract
is written down.

| reader | kind | contract |
|---|---|---|
| `server/webharness/project-cache.ts` | exhaustive | `drainPages`. Reads until a short page proves the end; throws rather than returning a partial board. |
| `tools/board-dump.mts` | exhaustive | Same `drainPages`. |
| `server/webharness/longpoll.ts` | **bounded window** | Most recent 50, then polls forward. No backwards paging. Reports `mayHaveEarlier`. |
| `server/routes/rooms.ts` | write | POSTs a message; its GET delegates to `longpoll` and has no traversal of its own. |
| `server/routes/projects.ts` | write | Appends a crew-event, refusing over 2000 characters. |

`server/__tests__/history-readers.test.ts` fails the build when a file appears
that reads or writes room history and is not on that list. The reason it is a
test rather than a paragraph is that a paragraph does not fail. This same
omission has now arrived four times in different clothes, the fourth being a
hand-rolled traversal in `tools/board-dump.mts` written *while this card was
being worked on*, in a repository whose `drain-pages.ts` opens by explaining
why not to do that.

### Live Chat is a window, and now says so

The first read asks for the most recent 50 messages and polls forward. There is
no way back: upstream's `before` cursor does not page — it returned the same
message twelve times. The client additionally caps its transcript at 500.

That is a reasonable design for a chat. What was not reasonable is that nothing
said so. Opening a 127-message room showed 50, the oldest of them sitting at the
top with nothing above it — indistinguishable from the start of the room. The
transcript now carries a line at that edge, and only when the first page came
back full, so a short room is not accused of hiding history it does not have.
Both cases checked in a browser: 127 messages → 50 shown with the note; 15
messages → all 15, no note.

### A correction to how this was first measured

The browser acceptance in PR #68 originally reported "history loads and does not
silently truncate: 127 rendered, zero gaps". That was **wrong**, and wrong in the
most embarrassing available way: the fake upstream returned the OLDEST page for
an uncursored read, so the client walked forward from message 1 and eventually
held everything. Against a server that answers with the most recent page — which
is what the skill documents this endpoint as, and what a chat obviously wants —
the same test shows 50 of 127 and no way back.

A mock that shares the code's assumption proves the assumption, not the code.
That is already the first entry in COLLABORATION.md's list of ways a green run
has lied here, and I reproduced it while writing the harness meant to prevent
exactly this class of mistake.
