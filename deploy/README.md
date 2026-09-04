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

# 3. TLS — after DNS points here
cp deploy/nginx.conf /etc/nginx/sites-available/fxg-crew
sed -i 's/SERVER_NAME_HERE/your.hostname/g' /etc/nginx/sites-available/fxg-crew
ln -sf /etc/nginx/sites-available/fxg-crew /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d your.hostname

# 4. from your laptop
deploy/release.sh root@your.hostname
```

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
5. `systemctl restart fxg-crew` — **you will be signed out** on current `main`

Step 5 currently fails, deliberately documented rather than quietly hoped past.
Durable sessions are in an unmerged branch (#16). The unit already sets
`SESSION_STORE_PATH`, but the code on `main` has an in-memory store and ignores
it, so **the variable is a no-op today and every restart or redeploy signs
everyone out**.

Do not read the presence of `SESSION_STORE_PATH` in the unit as evidence the
feature is live. It was configured ahead of the code, which is exactly the kind
of gap that reads as working. Once #16 merges, a `sessions.db` appears in
`/var/lib/fxg-crew/` and step 5 should pass — the absence of that file is the
check.

## Limits, stated plainly

- **Sessions are lost on restart** until #16 merges. See the smoke test.
- **Single instance** *(once #16 lands)*. SQLite gives restart-survival on one host. It does not
  give multi-instance sharing, and a SQLite file on network storage is a known
  way to corrupt a database. More than one replica needs Redis or a real
  database server; the `SessionStore` interface is the seam for that.
- **The Mission Control screen is still simulated** and labelled as such. Only
  Live Rooms is real data.
