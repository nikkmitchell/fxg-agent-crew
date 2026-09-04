# Add Mission Control beside classic WebHarness chat

The intended product is one continuous experience:

- `/` remains Wilson's existing WebHarness chat, with its current rooms,
  history, uploads, usernames, passwords, and agent identities.
- `/space/` opens FXG Mission Control.
- A **Space** control in the existing navigation links to `/space/`.
- Both surfaces use the same WebHarness account authority. No account or key is
  copied into the repository.

## What can ship now

Build and run Mission Control with the same mount value:

```bash
APP_BASE_PATH=/space pnpm build

APP_BASE_PATH=/space \
WEBHARNESS_URL=http://127.0.0.1:8000 \
SESSION_SECRET=<new high-entropy UI-session secret> \
NODE_ENV=production \
pnpm dev:bff
```

The reverse proxy should preserve the `/space` prefix and send both
`/space/*` and `/space/bff/*` to this Node service. Classic WebHarness keeps
every other route. The new UI uses the same existing username and password,
but a person signs in once on first entry to Space because its opaque session
cookie is deliberately separate from WebHarness internals.

Wilson can add the navigation control as a normal same-origin link:

```html
<a href="/space/">Space</a>
```

## Seamless one-click sign-in needs one upstream addition

Do not put a WebHarness bearer token in a query string, fragment, browser
storage, signed cookie, or form field. Compatibility of usernames is already
implemented; safe single-sign-on requires WebHarness itself to mint and redeem
a short-lived, single-use handoff.

Recommended flow:

1. The signed-in classic UI asks WebHarness for a one-time opaque ticket.
2. It submits that ticket by `POST` to `/space/bff/handoff`.
3. The Mission Control server redeems it server-to-server with WebHarness.
4. WebHarness invalidates the ticket and returns the authenticated username and
   bearer token only to the Mission Control server.
5. Mission Control stores the token server-side, sets its own secure httpOnly
   opaque session cookie, and redirects to `/space/` without the ticket.

Ticket requirements: at least 256 random bits, one use, expiry within 60
seconds, bound to the initiating WebHarness session and intended Space origin,
and never logged. The redemption endpoint must reject replays. Until Wilson
adds that server-side contract, keep the existing-account sign-in screen; it is
less seamless but does not weaken credential custody.

## Pre-deployment checks (no production probing)

- Build output references `/space/assets/...`, not root `/assets/...`.
- Browser requests use `/space/bff/...`.
- `/space/anything` returns the Space application, while unrelated classic-chat
  routes are not captured by the Space server.
- The browser never receives or logs a WebHarness bearer token or agent private
  key.
- With mocked upstream responses: existing login, room selection, polling,
  explicit send retry, logout, and expired-session recovery all work.
- Production smoke testing waits for Wilson and uses a disposable human account.
