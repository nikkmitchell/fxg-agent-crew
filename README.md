# FXG Agent Crew

A shared workroom where people and agents plan, decide and record work together,
with a standing rule: **the screen may only say what it can prove.** Anything
unknown renders as unknown rather than as a confident guess.

## What is actually running

Live at **https://saha.ing** — front door at `/`, Mission Control at `/space/`.
The classic WebHarness chat is untouched and cannot be captured by this service:
`release.sh` refuses to ship unless the app returns 404 for `/` and `/api/rooms`
on loopback.

The **Build** tab reports the deployed commit, or says UNKNOWN with a reason.
Treat that as more current than this file — a README is a claim, and the Build
tab is a measurement.

## What is real, and what is not

Real:

- **Projects, tasks, comments.** Stored as validated events in a WebHarness
  room, replayed on load. Create something, refresh, and it is still there.
- **Live rooms.** Session restoration, presence, long-poll, reconnect and
  read-only states, confirmed sends with explicit retry.
- **Sign-in for humans and agents.** Humans use their existing WebHarness
  username and password; agents present the bearer token they already hold,
  which is verified upstream. Sessions record which, and the UI labels it.
- **Durable sessions.** SQLite on one host; a restart no longer signs anyone
  out.

Not real, stated plainly:

- **Nothing has been built for either project yet.** Multiplayer Go and
  Meditation Experience carry recorded decisions, not code. The board says
  "done" on those cards meaning "decided", which is a distinction the board
  cannot currently express.
- **Single instance.** SQLite sessions do not survive the host being replaced
  and are not shared between replicas.

## Run locally

```bash
pnpm install
pnpm dev            # UI only
```

The whole same-origin application:

```bash
pnpm build
WEBHARNESS_URL=https://your-webharness-host.example \
  SESSION_SECRET=$(openssl rand -base64 48) \
  PORT=8787 \
  pnpm dev:bff
```

Open `http://127.0.0.1:8787`. With no `APP_BASE_PATH` the app serves from the
root; production sets `APP_BASE_PATH=/space`, and it must match the nginx
location **and** the Vite base used at build time. A mismatch loads the HTML and
404s every asset, which presents as a blank page rather than an error.

## Configuration

| variable | why |
|---|---|
| `WEBHARNESS_URL` | the existing WebHarness origin; accounts and memberships stay authoritative there |
| `SESSION_SECRET` | new, high-entropy, specific to this service |
| `APP_BASE_PATH` | where the app mounts. Absent, it owns `/` — which is how it once captured the chat |
| `SESSION_STORE_PATH` | must be writable. `ProtectSystem=strict` makes the working directory read-only, so the application default would crash on boot |
| `PROJECT_MUTATORS` | comma-separated usernames permitted to change project data. Room membership is not project authority |
| `PORT` / `HOST` | loopback in production; nginx faces the internet |

Deployment order matters and is documented in `deploy/README.md`. Follow it
rather than improvising: installing the TLS nginx config before a certificate
exists deadlocks the host against its own ACME challenge.

Never put bearer tokens, passwords or private keys into build variables,
client-side configuration, logs, or the event log.

## Product principles

- The work, not the agents' personalities, is the visual hero.
- Every status links to evidence, a decision, or an operator action.
- Unknown renders as unknown. A partial answer presented as complete is the
  failure this project exists to avoid.
- External credentials and private keys never enter the event log, and this
  process holds no signing capability — `server/__tests__/keycustody` fails the
  build if that ever changes.

## Operating notes

`docs/OPERATING-NOTES.md` records what has actually gone wrong here: the things
that look like success and are not, the tooling failures that reported false
results, the TLS ordering that deadlocks a fresh host, and the agent identity
that expires. Read it before trusting anything green.

## Known gaps

1. The board cannot distinguish a decision from a build, so "done" overstates.
2. Cold project replay costs a full room read; warm loads are folded forward.
3. Build status shows the deployed commit only — no branch or check results.
4. Agent Ed25519 login is broken upstream for at least one identity; bearer
   tokens still work and expire on their own schedule.
