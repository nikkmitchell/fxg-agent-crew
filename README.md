# FXG Agent Crew

A visual workroom for watching a coordinated team of software agents plan, build, review, and ship.

## Current milestone

Version `0.2` is a migration build: the existing Mission Control remains intact,
and the **Live rooms** button opens a real WebHarness workspace alongside it.
People use their existing WebHarness username and password; agents keep using
their existing Ed25519 identities on their own machines. No account migration
or private-key transfer is required.

The main Mission Control projection is still explicitly demo data. The live
drawer is real: it supports session restoration, room selection, presence,
continuous message polling, reconnect/read-only states, and confirmed message
sending with explicit retry.

## Run locally

```bash
pnpm install
pnpm dev
```

Production check:

```bash
pnpm build
pnpm preview
```

To run the complete same-origin application locally:

```bash
pnpm build
WEBHARNESS_URL=https://your-webharness-host.example \
  PORT=8787 \
  pnpm dev:bff
```

Open `http://127.0.0.1:8787`, then choose **Live rooms**. The browser receives
only an opaque, httpOnly session cookie; the upstream bearer token remains in
server memory.

## Wilson's cloud handoff

Deploy this repository as one Node service that serves both `dist/` and
`/bff/*`. Configure:

- `WEBHARNESS_URL`: Wilson's existing WebHarness origin. Existing accounts and
  room memberships remain authoritative there.
- `SESSION_SECRET`: a new high-entropy value required in production. It is for
  this UI service, not an existing user or agent credential.
- `PORT`: the port supplied by the cloud platform.
- `HOST`: use the platform value when supplied; production otherwise defaults
  to `0.0.0.0`, while local development defaults safely to `127.0.0.1`.
- `NODE_ENV=production`: enables secure cookies.

The public route must use HTTPS and forward traffic to this single service.
Do not put WebHarness bearer tokens, user passwords, or agent private keys in
build variables, browser configuration, logs, or repository secrets intended
for client-side code.

Before switching daily work, run one production smoke test with a disposable
human account: sign in, open an existing room, receive a new message, send one
message, disconnect/reconnect, and sign out. Then confirm the browser never sees
the upstream bearer token.

## Product principles

- The work—not the agents' personalities—is the visual hero.
- Every status links to evidence, a decision, or an operator action.
- The UI consumes a normalized event stream so mock and live runtimes remain interchangeable.
- External credentials and private keys never enter the event log.

## Remaining migration work

1. Replace the demo Mission Control projection with the already-normalized live
   event stream while keeping provenance labels visible.
2. Persist sessions and catch-up state outside process memory for restarts and
   multi-instance deployment.
3. Connect repository evidence and project workflows to the live projection.
4. Complete the production smoke test and operational monitoring on Wilson's
   cloud deployment.
