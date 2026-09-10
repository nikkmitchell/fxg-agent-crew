#!/usr/bin/env bash
# Build locally, ship, restart, and VERIFY. Run from a checkout.
#
#   deploy/release.sh user@host
#
# Verification checks the RUNNING SERVICE, not the exit code of the deploy. A
# deploy that "succeeded" because rsync exited 0 is the same class of claim as a
# green suite over a broken build: it reports what ran, not what works. This
# project has been bitten by that shape four separate times.
set -euo pipefail

TARGET="${1:?usage: release.sh user@host}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/fxg_deploy_ed25519}"
SSH=(ssh -i "$SSH_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new)
REMOTE=/opt/fxg-crew
# Mission Control is the site now; it was mounted at /space until 2026-09-10.
BASE=""

log()  { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

log "verify locally before shipping"
# This repo is pnpm (pnpm-lock.yaml). An earlier version ran `npm ci`, which
# needs a package-lock.json — so a package-lock was committed alongside the
# pnpm lockfile to satisfy it. Two lockfiles for one project is a reproducibility
# hazard: they can resolve to different trees, and the deployed artifact would
# then depend on which tool happened to run. Fixed at the cause instead.
command -v pnpm >/dev/null || corepack enable pnpm >/dev/null 2>&1 || true
PNPM="${PNPM:-pnpm}"
command -v "$PNPM" >/dev/null || fail "pnpm not found; run: corepack enable pnpm"
"$PNPM" install --frozen-lockfile || fail "install failed; nothing was deployed"
"$PNPM" exec vitest run || fail "tests failed; nothing was deployed"
# APP_BASE_PATH must match at BUILD time: Vite bakes the asset base into the
# bundle, so a mismatch produces HTML that loads and assets that 404 — a blank
# page with a 200 in the access log. Empty means the app owns `/`.
APP_BASE_PATH="$BASE" "$PNPM" run build || fail "build failed; nothing was deployed"

SHA=$(git rev-parse HEAD)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
[ "$DIRTY" = "0" ] || printf '\033[33mwarning: working tree has %s uncommitted change(s); deployed artifact will not match %s\033[0m\n' "$DIRTY" "${SHA:0:8}"

log "ship  (commit ${SHA:0:8})"
# node_modules and generated output excluded: the host installs production deps
# and the build is shipped as built, not rebuilt from a dirty tree.
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude 'dist/.vite' \
  -e "${SSH[*]}" ./ "$TARGET:$REMOTE/"

# The static site, which nothing used to deploy.
#
# nginx answers `/` from /var/www/saha on disk — a different tree from the app
# in /opt/fxg-crew — so index.html and robots.txt were hand-copied and drifted
# silently. That is also why I was hand-copying deploy/nginx.conf at all on
# 2026-09-08, which is how I put an unsubstituted template over the live config.
# A file that only ever moves by hand eventually moves wrong.
"${SSH[@]}" "$TARGET" "mkdir -p /var/www/saha"
# robots.txt only. The static landing page was removed when Mission Control
# moved to `/` — its entire content was a link to the real page. Left in this
# rsync it would have failed every deploy, which is the shape of bug that comes
# from two branches each being green and only their MERGE being wrong.
rsync -az -e "${SSH[*]}" deploy/robots.txt "$TARGET:/var/www/saha/"
"${SSH[@]}" "$TARGET" "rm -f /var/www/saha/index.html"

# Record exactly what was deployed, so the running service is traceable to a
# commit rather than to "whatever was on someone's laptop".
"${SSH[@]}" "$TARGET" "printf '%s\n' '$SHA' > $REMOTE/DEPLOYED_COMMIT"

# The branch and the tree's cleanliness, recorded at ship time because they
# cannot be recovered later: .git is excluded from the rsync, so the host has no
# way to answer "which branch is this?" once the deploy has finished.
#
# Both have mattered here. A branch deployed while main moved on took hours to
# notice, and "the deployed artifact will not match this commit" is warned about
# above and then forgotten by everyone including the person who saw it.
BRANCH=$(git rev-parse --abbrev-ref HEAD)
TREE=$([ "$DIRTY" = "0" ] && echo clean || echo "dirty:$DIRTY")
"${SSH[@]}" "$TARGET" "printf '%s\n' '$BRANCH' > $REMOTE/DEPLOYED_BRANCH"
"${SSH[@]}" "$TARGET" "printf '%s\n' '$TREE' > $REMOTE/DEPLOYED_TREE"

log "install production deps + restart"
"${SSH[@]}" "$TARGET" bash -euo pipefail <<'REMOTE_CMDS'
  cd /opt/fxg-crew
  # Same lockfile rule as the local side: pnpm, frozen, production only.
  command -v pnpm >/dev/null || corepack enable pnpm >/dev/null 2>&1 || true
  pnpm install --prod --frozen-lockfile
  chown -R fxgcrew:fxgcrew /opt/fxg-crew
  systemctl daemon-reload
  systemctl restart fxg-crew
REMOTE_CMDS

log "verify the running service"
# Wait for genuine stability rather than an instant reading: `systemctl
# is-active` answers "active" during the restart backoff window, so a
# crash-looping service looks healthy to it. Compare the restart counter across
# a window instead.
before=$("${SSH[@]}" "$TARGET" "systemctl show fxg-crew -p NRestarts --value")
sleep 12
after=$("${SSH[@]}" "$TARGET" "systemctl show fxg-crew -p NRestarts --value")
[ "$before" = "$after" ] || fail "service is crash-looping (NRestarts $before -> $after)"

code=$("${SSH[@]}" "$TARGET" "curl -sS -o /tmp/me.json -w '%{http_code}' http://127.0.0.1:8787$BASE/bff/me")
body=$("${SSH[@]}" "$TARGET" "cat /tmp/me.json")
[ "$code" = "401" ] || fail "$BASE/bff/me returned $code, expected 401"
grep -q SESSION_EXPIRED <<<"$body" || fail "$BASE/bff/me missing SESSION_EXPIRED: $body"

"${SSH[@]}" "$TARGET" "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787$BASE/" | grep -q 200 \
  || fail "$BASE/ did not return 200"

# THE ISOLATION CHECK, narrowed on purpose rather than deleted.
#
# It used to assert that `/` returned 404, because Mission Control was mounted
# at /space so it could share an origin with classic chat without capturing its
# routes. Chat moved to its own domain and the mount went with it, so `/` is now
# ours and must answer 200 — the old assertion would fail, and the wrong fix
# would have been to quietly drop the whole block.
#
# The REASON survives the mount. /api/ is still reserved by the service itself,
# so if anything else is ever served from this origin it cannot be swallowed by
# the SPA fallback. That is the half worth keeping, and it is still checked.
root_code=$("${SSH[@]}" "$TARGET" "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/")
[ "$root_code" = "200" ] || fail "/ returned $root_code, expected 200 — the app owns the root path now"

other=$("${SSH[@]}" "$TARGET" "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/rooms")
[ "$other" = "404" ] || fail "/api/rooms returned $other, expected 404 — /api is reserved and must not be captured"

listening=$("${SSH[@]}" "$TARGET" "ss -ltn | grep ':8787' || true")
grep -q '127.0.0.1:8787' <<<"$listening" || fail "8787 is not loopback-bound: $listening"

# THE CONFIG-ON-DISK CHECK.
#
# nginx serves from the config it loaded, not the one on disk. On 2026-09-08 an
# unsubstituted template sat at /etc/nginx/sites-available/fxg-crew for half an
# hour while the running nginx served happily from memory: site up, access log
# normal, and the host one reboot away from an nginx that could not start. No
# check anywhere would have caught it, and a release would have shipped straight
# past it every time.
#
# So: assert the file on disk is one nginx could actually start with.
placeholder=$("${SSH[@]}" "$TARGET" "grep -c SERVER_NAME_HERE /etc/nginx/sites-available/fxg-crew || true")
[ "$placeholder" = "0" ] || fail "nginx config on disk still contains SERVER_NAME_HERE — nginx could not restart with it. Reinstall with deploy/install-nginx.sh <host>"
"${SSH[@]}" "$TARGET" "nginx -t" >/dev/null 2>&1 \
  || fail "nginx -t fails against the config on disk — the running nginx is serving from memory and will not come back after a restart"

# The DEPLOYED nginx config, not the one in the repo.
#
# install-nginx.test.sh checks the repo's copy. This checks the one actually
# running, because they drift — that is how an unsubstituted template sat on
# disk for half an hour, and how a 2m body limit sat under a 12MB app limit for
# a day while every test passed.
NGINX_LIMIT=$("${SSH[@]}" "$TARGET" "grep -o 'client_max_body_size [0-9]*m' /etc/nginx/sites-available/fxg-crew | grep -o '[0-9]*'" || true)
APP_LIMIT=$(grep -o 'MAX_BYTES = [0-9]*' server/db/blobs.ts | grep -o '[0-9]*')
if [ -z "$NGINX_LIMIT" ] || [ "$NGINX_LIMIT" -le "$APP_LIMIT" ]; then
  fail "nginx accepts ${NGINX_LIMIT:-?}m but the app accepts ${APP_LIMIT}m — nginx would refuse uploads the app would take, in its own words rather than ours"
fi

upgrade=$("${SSH[@]}" "$TARGET" "grep -c 'proxy_set_header Upgrade' /etc/nginx/sites-available/fxg-crew || true")
[ "$upgrade" = "0" ] && fail "the deployed nginx cannot upgrade a WebSocket — a handshake would get index.html and a confusing parse error"

# THE HANDSHAKE ITSELF, not the presence of a header line.
#
# The grep above proves the config says the right words. This proves a real
# upgrade completes. curl reports 101 and then sits there holding the socket
# open, which is correct behaviour and looks like a hang — hence --max-time and
# the exit code being ignored. %{http_code} is written regardless.
ws() {
  curl -sS -o /dev/null -w '%{http_code}' --http1.1 -N --max-time 6 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
    "$1" 2>/dev/null || true
}
app_ws=$("${SSH[@]}" "$TARGET" "curl -sS -o /dev/null -w '%{http_code}' --http1.1 -N --max-time 6 -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' http://127.0.0.1:8787$BASE/bff/space/socket 2>/dev/null || true")
[ "$app_ws" = "101" ] || fail "$BASE/bff/space/socket returned $app_ws to a handshake, expected 101 — the space socket is not registered"

# Public verification, when a public URL is given. Everything above this point
# is loopback: it proves the service answers, not that anyone can reach it.
# TLS, DNS and the nginx vhost sit between those two facts, and each has broken
# here independently. Skipped is said out loud rather than passing quietly,
# because a check that silently does nothing is worse than no check.
if [ -n "${PUBLIC_URL:-}" ]; then
  log "verify the public URL  ($PUBLIC_URL)"
  for path in / /board /robots.txt; do
    pub=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${PUBLIC_URL%/}$path") \
      || fail "could not reach ${PUBLIC_URL%/}$path"
    [ "$pub" = "200" ] || fail "${PUBLIC_URL%/}$path returned $pub, expected 200"
    printf '  %-12s 200\n' "$path"
  done

  # Old links must keep working. Mission Control lived under /space until
  # 2026-09-10, and a bookmark that 404s reads as "the site is gone".
  moved=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 20 "${PUBLIC_URL%/}/space/board")
  case "$moved" in 301|302) printf '  %-12s %s -> redirected\n' "/space/board" "$moved" ;;
    *) fail "/space/board returned $moved, expected a redirect to the new location" ;;
  esac
  grep -qi 'disallow' <<<"$(curl -sS --max-time 20 "${PUBLIC_URL%/}/robots.txt")" \
    || fail "/robots.txt is served but contains no Disallow directive"

  # The only check that proves nginx actually upgrades. Everything before it
  # proves the app does, which is the half that was never broken.
  #
  # Kept on https:// rather than rewritten to wss://. curl speaks WebSocket
  # natively for a ws:// or wss:// URL and then ignores hand-written upgrade
  # headers, which produced a flat 000 and an error message accusing nginx of
  # not upgrading while it was upgrading perfectly well. As an HTTP request with
  # the headers spelled out, the 101 is the server's answer, not curl's.
  pub_ws=$(ws "${PUBLIC_URL%/}/bff/space/socket")
  [ "$pub_ws" = "101" ] || fail "the public /bff/space/socket returned $pub_ws to a handshake, expected 101 — nginx is not upgrading"
  printf '  %-12s 101 (upgraded)\n' "/bff/space/socket"
else
  printf '\033[33mnote: PUBLIC_URL not set — only loopback was verified. Nothing here says the site is reachable from outside.\033[0m\n'
fi

deployed=$("${SSH[@]}" "$TARGET" "cat $REMOTE/DEPLOYED_COMMIT")
[ "$deployed" = "$SHA" ] || fail "deployed commit $deployed != $SHA"

printf '\n\033[32mDeployed and verified.\033[0m  commit %s\n' "${SHA:0:8}"
printf '  %s/bff/me   401 SESSION_EXPIRED\n  %s/          200\n' "$BASE" "$BASE"
printf '  /api/rooms   404  (reserved, not captured)\n'
printf '  8787         loopback only\n  restarts     stable over 12s\n'
printf '  nginx.conf   valid on disk (would survive a restart)\n'
printf '  space socket 101 on loopback\n'
[ -n "${PUBLIC_URL:-}" ] && printf '  public       %s reachable\n' "$PUBLIC_URL" \
                        || printf '  public       NOT CHECKED (set PUBLIC_URL)\n'
