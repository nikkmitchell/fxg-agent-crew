# Deploying FXG Agent Crew

One Node service behind nginx. It serves the built UI and `/bff/*` from a single
origin — that is deliberate, not incidental: same-origin removes the CORS problem
rather than working around it, and it lets the session cookie stay `httpOnly`.

## What this service holds

A WebHarness bearer token for every signed-in human, in server-side storage. A
compromise here is a credential compromise for those accounts, which is why the
unit is hardened and the secret file is root-only. Treat it accordingly.

## Order

```bash
# 1. on the server, as root
bash deploy/provision.sh

# 2. secrets
mkdir -p /etc/fxg-crew
cp deploy/env.example /etc/fxg-crew/env
sed -i "s|SESSION_SECRET=REPLACE_ME|SESSION_SECRET=$(openssl rand -base64 48)|" /etc/fxg-crew/env
chmod 600 /etc/fxg-crew/env

# 3. TLS — after DNS points here.
#
# ORDER MATTERS, and getting it wrong deadlocks the host. nginx.conf references
# /etc/letsencrypt/live/<host>/fullchain.pem. On a machine that has never run
# certbot that file does not exist, so `nginx -t` FAILS and nginx will not
# start — and a stopped nginx cannot serve the ACME challenge that would create
# the certificate. It presents as "nginx is broken", not as "wrong order".
#
# So: HTTP-only bootstrap first, certificate second, TLS config third.

# 3a. bootstrap: HTTP only, serves nothing but the ACME challenge
mkdir -p /var/www/html/.well-known/acme-challenge
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/fxg-crew /etc/nginx/sites-enabled/
deploy/install-nginx.sh your.hostname --bootstrap --reload

# 3b. obtain the certificate via the webroot the bootstrap config serves.
# --webroot, not --nginx: certbot's nginx plugin rewrites the config, and we
# want the file we reviewed to be the file that runs.
certbot certonly --webroot -w /var/www/html -d your.hostname --agree-tos -m you@example.com -n

# 3c. NOW the real config, which can finally find the certificate
mkdir -p /var/www/saha
cp deploy/index.html deploy/robots.txt /var/www/saha/
deploy/install-nginx.sh your.hostname --reload

# 3d. prove renewal works before trusting HSTS
certbot renew --dry-run

# 4. from your laptop
PUBLIC_URL=https://your.hostname deploy/release.sh root@your.hostname
#
# PUBLIC_URL is optional but worth setting: without it the release only ever
# verifies loopback, which proves the service answers, not that anyone outside
# can reach it. DNS, TLS and the nginx vhost all sit between those two facts.
```

## The root path

`https://your.hostname/` **is** Mission Control. nginx proxies everything to
Node except `/robots.txt`, which stays on disk so it keeps answering when the
service is down — a crawler that gets a 502 learns nothing about whether it may
index the host.

It was not always this way. Mission Control was mounted at `/space` so it could
share an origin with classic chat without capturing its routes, and `/` served a
static landing page. Chat moved to its own domain on 2026-09-10, which left a
front page whose entire content was a link to the real page.

**The isolation that mount provided did not leave with it.** The Node service
reserves `/api/` itself and answers 404 there, so anything else served from this
origin later cannot be swallowed by the SPA fallback. `release.sh` still checks
it. That is the half of the old guarantee that was worth keeping — and it was
worth keeping deliberately, rather than deleting the whole check because the
first half of it had started to fail.

`/space` and `/space/*` redirect permanently to the new locations, so links
bookmarked before the move still land somewhere useful.

## An IP address is not enough

`certbot` needs a hostname. Running this on a bare IP means no TLS, and without
TLS the session cookie — which authorises a real WebHarness account — travels in
plaintext to anyone on the path. Point a DNS name at the host before exposing it
to anyone.

## Verification is part of the deploy

`release.sh` refuses to ship if tests or the build fail, and after restarting it
checks the *running service* rather than the exit code of the deploy:

- `/bff/me` returns **401** with `SESSION_EXPIRED` — the auth boundary is live
- `/` returns **200** — the UI is actually served
- `:8787` is bound to **127.0.0.1** — the Node process is not internet-facing

A deploy that "succeeded" because `rsync` exited 0 is the same class of claim as
a green suite over a broken build: it reports what ran, not what works.

## Smoke test after the first deploy

Use a disposable WebHarness account, never a real one:

1. open the site, sign in
2. confirm the response body is `{"username":"..."}` with **no token** in it
3. confirm the cookie is `HttpOnly` and `Secure`
4. open Live Rooms, pick a room, send a message, see it appear
5. `systemctl restart fxg-crew` — **you must still be signed in afterwards**
6. hard-refresh the page — the transcript must show history, not an empty room
7. `ls -l /var/lib/fxg-crew/sessions.db` — must exist and be non-empty

Steps 5-7 are the #16 acceptance check. **#16 is merged** (58bdbf4): sessions are
durable across a restart on a single instance.

Step 5 and step 6 prove different things, and passing 5 alone is not a pass.
Step 5 proves *authentication* survived. Step 6 proves the browser still gets
*history* — a restored server-side cursor that silently resumed mid-stream would
leave a freshly loaded page showing an empty transcript, which is the failure
#16 was written to avoid.

The absence of `sessions.db` is the fast negative check: if that file is missing,
`SESSION_STORE_PATH` is wrong or its directory is not writable, and sessions are
in memory no matter what the configuration says.

## Limits, stated plainly

- **Sessions survive a restart on one host** (#16). They do not survive the box
  being replaced, and the 7-day WebHarness token behind a session still expires
  on its own schedule.
- **Single instance.** SQLite gives restart-survival on one host. It does not
  give multi-instance sharing, and a SQLite file on network storage is a known
  way to corrupt a database. More than one replica needs Redis or a real
  database server; the `SessionStore` interface is the seam for that.
- **The Mission Control screen is still simulated** and labelled as such. Only
  Live Rooms is real data.

## Never `cp` nginx.conf by hand

`deploy/nginx.conf` is a template: it names the certificate as
`/etc/letsencrypt/live/SERVER_NAME_HERE/fullchain.pem`. Copying it onto a host
without substituting produces a file that `cp` accepts and `nginx -t` rejects.
The running nginx keeps serving from the config already in memory, so the site
stays up and nothing looks broken — until the next restart or reboot, when
nginx cannot start at all.

That happened on 2026-09-08. Use `deploy/install-nginx.sh <host> [--reload]`
instead: it substitutes, picks up every name on the existing certificate (so
installing with the apex does not silently drop `www`), refuses to write a file
that still contains a placeholder, backs up what it replaces, and restores that
backup if `nginx -t` fails.

## Backups — not optional any more

Until ADR-002, saha.ing was disposable: everything on it could be rebuilt by
replaying chat. Uploaded images exist nowhere else, so from the first upload a
lost disk is lost work.

```bash
# once, on the host
cp deploy/fxg-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now fxg-backup.timer
systemctl list-timers fxg-backup.timer     # confirm it is actually scheduled
```

`backup.sh --verify` restores the snapshot it just took, reads from it, and
checks that every blob the database references is present in the backup. A
backup nobody has restored is not a backup, and a database that references
files the backup does not contain restores into a board full of broken images.

It uses `sqlite3 .backup`, never `cp`: copying a live SQLite file gives you
whatever was on disk mid-write, and with WAL enabled the copy can be missing
committed transactions that live in the `-wal` file.
