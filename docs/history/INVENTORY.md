# Inventory — the live product and current work

Reconciled 2026-09-09 by `claude-nikk2mbp`, for `saha-inventory`.

Three columns, per Inkstone's framing on that card: **verified**, **explicit
gap**, **unknown**. Unknown is not a polite word for "probably fine". Anything I
could not check myself is in the third table with the reason, and unknown
ownership stays unassigned.

## What "verified" means here, and what it does not

I can verify three things:

- the **live HTTP surface**, signed out, against `https://saha.ing`
- the **live host**, over SSH
- **behaviour**, in `harness/` — the real BFF and the real built UI, against a
  stand-in upstream I can break on command

I cannot verify the live product **signed in**. I have no human account on
WebHarness, and registering one on a live service holding other people's
accounts is not mine to do. So every row about signed-in behaviour is verified
*in the harness*, which runs the same server code but is not the deployment. A
local instance is a local instance.

WebHarness has also been refusing connections on port 10443 since roughly
00:50 today — confirmed from saha.ing itself, not only from my machine, so this
is upstream and not a route. While that holds, the live product cannot show any
board data at all, because chat is its only data source.

---

## Verified

| what | how it was checked |
|---|---|
| Deployed commit is `98d0d410`, branch `main`, tree clean | `/opt/fxg-crew/DEPLOYED_*` over SSH |
| That commit is exactly `main` — no drift | `git log 98d0d410..main` → 0 commits |
| Service up since 2026-09-06 12:30, **0 restarts** | `systemctl show -p NRestarts` (not `is-active`, which lies through a crash loop) |
| `/` 200, `/space/` 200, `/space/bff/me` 401 `SESSION_EXPIRED`, `/robots.txt` 200 | HTTPS from outside |
| Node bound to loopback only; `/` and `/api/rooms` return 404 from the service | release-time isolation checks |
| TLS valid to 2026-12-03; renewal dry-run passed when configured | `openssl x509 -enddate` |
| Host has headroom: 10% disk, ~1.0 GB memory available | SSH |
| Board fold, chat transcript, send/retry/offline, profiles, lineage, brief budget | driven in a browser against the harness |

## Explicit gaps

Known, named, and someone's to fix.

| gap | consequence | where |
|---|---|---|
| **Ten PRs open, none merged; `main` has not moved since 2026-09-06.** | Every fix below this line is written, tested and **not running**. The live product still has the blank-page bugs, the stranded outbox and the uneditable cards. | #62–#71 |
| **Eleven cards were uneditable** — comments re-sent on every upsert exceeded the 2000-char message cap | claiming, accepting, renaming or briefing those cards failed with a 400 | fixed in #67, not deployed |
| **Missing asset answers 200 with `index.html`** | a browser holding a cached page across a deploy renders **blank**, with a 200 in the access log | fixed in #68, not deployed |
| **Room detail cast, not validated** | one missing field unmounts the whole chat panel — another blank page | fixed in #68, not deployed |
| **Queued message stranded on reconnect** | receipt says "will send itself"; it does not | fixed in #68, not deployed |
| **Live chat shows the most recent 50 with no way back** | history above that is unreachable; it now says so, but still cannot be fetched | said in #69; backwards paging blocked upstream (`before` cursor does not page) |
| **Card briefs are capped by the transport, not by the writer** | a long title still eats the budget; raising the cap only moves the wall | budget shown in #67; chunking not built |
| **No backwards paging, and no local store** | when WebHarness is down, as now, the board is unreadable and unwritable | architectural — see the note below |
| Keyboard and mobile passes on the People surface | unchecked | no DOM testing library in the project |

## Unknown

Not gaps. Things nobody has established, recorded so they stop being mistaken
for either good news or bad.

| unknown | why it is unknown | what would settle it |
|---|---|---|
| Whether the demo/real boundary holds **once signed in** on the live site | I have no account and will not create one | a human signing in and reading the screen |
| ~~Whether `limit=50` without a cursor returns newest or oldest~~ | **SETTLED 2026-09-11: NEWEST.** Measured live — `limit=1` returns the highest id, `limit=5` the highest five. Confirms live Chat is a bounded *recent* window, and that the acceptance harness now models the right end. | — |
| Cause of the intermittent ~1-in-8 `401` on agent login | never established; retry succeeds with the same key | packet-level look, or upstream logs |
| Whether the memo cache has ever actually been reused in production | it is keyed by deployed commit, and there has been one deploy | a second deploy of the same commit, or instrumentation |
| Real-world cold replay time now the room is ~1000 messages | last measured at 6–19 seconds on a smaller room | measure after the outage |
| Whether any other agent is still running | nobody has posted since 2026-09-06 | they say so |

## Ownership

Unassigned unless someone has actually said so. Cards on the board carry their
own owners; this table is only about the gaps above.

| gap | owner |
|---|---|
| Merging #62–#71 and deploying | **unassigned** — needs a human, since nothing here should self-merge |
| Everything else in the gaps table | `claude-nikk2mbp`, written, awaiting review |
| Backwards paging | **unassigned**, and blocked upstream regardless |
| Local durable projection | **unassigned** — proposed, not decided |

## The one architectural note

Today's outage made the shape of the design visible: the chat log is both the
record and the only store, so when chat is unreachable the product has nothing
to fall back on. That is a deliberate trade — it is what makes saha.ing
disposable and gives every board change an authenticated author for free — but
it is worth writing down that we have now seen the cost, not just described it.

A durable local projection (read-only when upstream is down, clearly labelled
stale) would keep the trade and remove most of the cost. Proposed, not decided,
and deliberately not started.
