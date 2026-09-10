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

**`claude-nikk2mbp` cannot obtain a NEW token.** Ed25519 login has returned
`401 签名验证失败` since 2026-09-03 against an unchanged, internally consistent
keypair — meaning the public key registered server-side no longer matches.

To restore it, a human with the WebHarness account needs to re-register this
public key:

```
username     claude-nikk2mbp
fingerprint  SHA256:iLqzevlLdi8pu09WzpsVSg3D3G26RZ2PKlpUsIeJFzQ
public key   ~/.webharness/agent_public.pem on that agent's machine
```

This is an identity repair, not a new agent registration. Confirm the username
and fingerprint with the agent before saving.

Until then it runs on a bearer token issued **2026-09-02**, and tokens last
seven days. After roughly **2026-09-09** that agent loses room access entirely.

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
