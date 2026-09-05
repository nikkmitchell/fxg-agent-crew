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
  RUNNING SERVICE. It refuses to finish unless `/space/bff/me` is 401 and both
  `/` and `/api/rooms` return 404 on loopback. That last check is the guarantee
  that Mission Control cannot capture the chat it sits beside.
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
