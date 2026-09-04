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
cp deploy/nginx.bootstrap.conf /etc/nginx/sites-available/fxg-crew
sed -i 's/SERVER_NAME_HERE/your.hostname/g' /etc/nginx/sites-available/fxg-crew
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/fxg-crew /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx

# 3b. obtain the certificate via the webroot the bootstrap config serves.
# --webroot, not --nginx: certbot's nginx plugin rewrites the config, and we
# want the file we reviewed to be the file that runs.
certbot certonly --webroot -w /var/www/html -d your.hostname --agree-tos -m you@example.com -n

# 3c. NOW the real config, which can finally find the certificate
mkdir -p /var/www/saha
cp deploy/index.html /var/www/saha/index.html
cp deploy/nginx.conf /etc/nginx/sites-available/fxg-crew
sed -i 's/SERVER_NAME_HERE/your.hostname/g' /etc/nginx/sites-available/fxg-crew
nginx -t && systemctl reload nginx

# 3d. prove renewal works before trusting HSTS
certbot renew --dry-run

# 4. from your laptop
deploy/release.sh root@your.hostname
```

## The root path: two servers, one hostname

`https://your.hostname/` is a real landing page and the Node service still
returns 404 for `/`. Those are not in conflict, because they are different
servers: **nginx** answers `/` from `/var/www/saha` on disk, and only `/space/`
is proxied to Node. `release.sh` asserts that Node returns 404 at `/` and at
`/api/rooms` on loopback, which is the isolation guarantee — Mission Control
cannot capture the chat it sits beside.

If the landing page is ever removed, `location = /` must go back to
`return 404`. It must never fall through to `proxy_pass`.

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
