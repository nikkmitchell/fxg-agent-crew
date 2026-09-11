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

### Voice: why an utterance has two fields

`say` is read aloud and is capped at 240 characters. `detail` is written down,
never spoken, and is effectively uncapped. That split is the whole mechanism
behind "agents are brief with people and detailed with each other" — with one
field it would have depended on everyone remembering to be brief.

A `say` over the limit is **refused with its reason, never truncated**. Same
rule as `FORBIDDEN_PROFILE_KEYS`: silently shortening tells the sender their
words were used when they were not, and with speech the sender cannot hear what
came out, so they would never find out.

`source` records whether the words arrived from a microphone or a keyboard,
because a transcript is a GUESS about what somebody said and typed text is not.
`confidence` is recorded when recognition offers one, and is only ever shown —
it never hides a transcript.

`POST /bff/space/utterances` records and broadcasts; `GET` returns the recent
ones so a client that reconnects does not lose the conversation. Utterances are
broadcast as their own socket message rather than folded into a snapshot: a
snapshot is state and is safe to miss, an utterance is an event and missing one
loses it.

### Photographs of the pages, for the headset

A headset session draws 3D only, so the live panels cannot be in it. A separate
service drives a headless browser over the same pages and writes PNGs, which the
scene hangs as textures and labels with their age.

```
fxg-stills.service  ->  chromium  ->  /board?embed=1  ->  /opt/fxg-crew/data/stills/board.png
```

- **It is not a second renderer.** Nothing in it knows what a card looks like.
  It photographs the page everyone else uses, so it cannot drift from it.
- **It sleeps unless somebody is looking.** The app touches a `wanted` file when
  a still is fetched; the renderer skips every cycle while that file is stale,
  and only launches a browser for the seconds it is actually rendering. An idle
  box runs no Chrome.
- **Its own systemd unit, with `MemoryMax=700M`.** Chrome is the largest thing
  on this box and the likeliest to leak. Inside the app an OOM kill would take
  the site down; out here the kernel kills the renderer and systemd restarts it.
  Measured peak on this hardware: 234MB, about 3 seconds per page.
- **The browser lives in `/opt/ms-playwright`**, not `~/.cache`, because the
  unit sets `ProtectHome=true`. `PLAYWRIGHT_BROWSERS_PATH` in the unit must keep
  matching wherever it was installed.

#### The render session, and when it stops being safe

`POST /bff/space/render-session` mints a session **without a password**. It is
loopback-only and requires the secret in `/etc/fxg-crew/stills.env`, which is
generated on the box and is not in the repo; with no secret set the endpoint
refuses everything, so an unconfigured deployment cannot mint one at all.

**The `render` actor can read whatever any signed-in person can read.** That is
acceptable today only because reads here take no authority argument — everyone
signed in already sees the same board. **The day reads become gated per project
or per person, this becomes a way to photograph things the viewer is not
entitled to**, because one photograph is served to everybody. Revisit it then:
either render per viewer, or drop the feature.

### Why is that figure standing there?

Every position in the room comes from a row in `audit`. `server/space/activity.ts`
polls the table forward from the end of it every 500ms and
`server/space/destinations.ts` maps one row to one place to stand. So "Plumbline
is at the Board panel" is answerable with a query, not a guess:

```sql
SELECT id, at, actor_id, action, entity, entity_id
  FROM audit WHERE actor_id = 'Plumbline' ORDER BY id DESC LIMIT 5;
```

Three things that look like bugs and are not:

- **The room is still after a restart.** The poller starts at `MAX(id)`, not at
  zero. Replaying the table would march everyone through months of work in a few
  seconds — motion that is not happening.
- **Somebody standing on their own away from the panels.** That means no audit
  row for them in the last two minutes. It does not mean idle, and nothing in
  the UI says it does.
- **An action that moves nobody.** `destinationFor` returns null for anything it
  does not recognise rather than picking a default spot. If a new action type is
  added to `BoardStore` and nobody moves for it, that is the reason — add it to
  `destinations.ts`.

### The panels are the real tabs

The three panels in the room are same-origin **iframes** of `/board`, `/mood`
and `/people` with `?embed=1`, which renders a tab's content without the
navigation rail or header. They are live and interactive and need no code of
ours to stay current — which is the entire reason they replaced a hand-drawn
projection of the same data.

Consequences worth knowing:

- **nginx sends `X-Frame-Options: SAMEORIGIN`** and `frame-ancestors 'self'`,
  not `DENY`. Framing by other sites is still refused;
  `deploy/install-nginx.test.sh` asserts both the restriction and its exact
  value, because a permissive value here is a silent clickjacking hole.
- **Three panels means three copies of the app running.** Each iframe is a full
  SPA with its own polling. That is the price of not maintaining a second
  renderer, and it is paid only by people who open the room.
- **They do not appear in a headset.** DOM cannot be composited into a WebXR
  frame — see `docs/HEADSET-CHECKS.md`.

### The 3D room's dependencies

`react` is pinned by `@react-three/fiber` 9.7, whose peer range is
`>=19 <19.3`. We are on 19.2.8 — inside it, with almost no room. Upgrading
React past 19.3 means moving R3F at the same time; they cannot be bumped
separately.

`@types/three` lags `three` by one minor (0.185.4 against three 0.186.0). That
is normal for DefinitelyTyped and not worth pinning around, but it means a type
error about a brand-new three API is more likely to be a stale type than a
mistake.

`@react-three/drei` provides `Html`, which is how the panels get into 3D. Its
transform mode maps one world unit to 40 CSS pixels through a constant it does
not export — `src/space/WebPanel.tsx` documents where that number comes from. A
drei upgrade that changes it will make every panel uniformly the wrong size,
which is at least obvious.

Development: `pnpm exec tsx tools/dev-room-harness.mts` runs the server with
several people already in the room and prints cookies for them. It mints
sessions without a password and refuses to run with NODE_ENV=production. It is
the only way to look at the room with more than one person in it, because
signing in otherwise needs WebHarness.

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
