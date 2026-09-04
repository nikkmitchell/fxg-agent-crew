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
BASE=/space

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
# APP_BASE_PATH must be set at BUILD time too: Vite bakes the asset base into
# the bundle. Building without it produces HTML that loads and assets that 404.
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

# Record exactly what was deployed, so the running service is traceable to a
# commit rather than to "whatever was on someone's laptop".
"${SSH[@]}" "$TARGET" "printf '%s\n' '$SHA' > $REMOTE/DEPLOYED_COMMIT"

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

# THE ISOLATION CHECK. Mission Control must not answer for anything above its
# mount. If this ever returns 200, the service is capable of capturing the
# chat it is supposed to sit beside.
root_code=$("${SSH[@]}" "$TARGET" "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/")
[ "$root_code" = "404" ] || fail "/ returned $root_code, expected 404 — this service must NOT own the root path"

other=$("${SSH[@]}" "$TARGET" "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/api/rooms")
[ "$other" = "404" ] || fail "/api/rooms returned $other, expected 404 — unrelated chat routes must not be captured"

listening=$("${SSH[@]}" "$TARGET" "ss -ltn | grep ':8787' || true")
grep -q '127.0.0.1:8787' <<<"$listening" || fail "8787 is not loopback-bound: $listening"

deployed=$("${SSH[@]}" "$TARGET" "cat $REMOTE/DEPLOYED_COMMIT")
[ "$deployed" = "$SHA" ] || fail "deployed commit $deployed != $SHA"

printf '\n\033[32mDeployed and verified.\033[0m  commit %s\n' "${SHA:0:8}"
printf '  %s/bff/me   401 SESSION_EXPIRED\n  %s/          200\n' "$BASE" "$BASE"
printf '  /            404  (chat not captured)\n  /api/rooms   404  (chat not captured)\n'
printf '  8787         loopback only\n  restarts     stable over 12s\n'
