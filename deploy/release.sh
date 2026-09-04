#!/usr/bin/env bash
# Build locally, ship, restart, and VERIFY. Run from a checkout on your machine.
#
#   deploy/release.sh user@host
#
# Verification is not optional here. A deploy that "succeeded" because rsync
# exited 0 is the same class of claim as a green test suite over a broken
# build — it reports what ran, not what works.
set -euo pipefail

TARGET="${1:?usage: release.sh user@host}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/fxg_deploy_ed25519}"
SSH_OPTS=(-i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)
REMOTE=/opt/fxg-crew

log() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
fail() { printf '\033[31mFAILED: %s\033[0m\n' "$*" >&2; exit 1; }

log "verify locally before shipping"
npm ci --silent
npx vitest run   || fail "tests failed; nothing was deployed"
npm run build    || fail "build failed; nothing was deployed"

log "ship"
# node_modules excluded deliberately: the host installs production deps itself,
# so a local dev-only or platform-specific artifact cannot ride along.
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude dist/.vite \
  -e "ssh ${SSH_OPTS[*]}" \
  ./ "$TARGET:$REMOTE/"

log "install production deps + restart"
ssh "${SSH_OPTS[@]}" "$TARGET" bash -euo pipefail <<'REMOTE_CMDS'
  cd /opt/fxg-crew
  npm ci --omit=dev --silent
  chown -R fxgcrew:fxgcrew /opt/fxg-crew
  systemctl daemon-reload
  systemctl restart fxg-crew
  sleep 3
  systemctl is-active --quiet fxg-crew || { journalctl -u fxg-crew -n 40 --no-pager; exit 1; }
REMOTE_CMDS

log "verify the running service, not the deploy command"
# Signed-out /bff/me must be 401 with a switchable code. A 200 here would mean
# the auth boundary is not doing its job.
code=$(ssh "${SSH_OPTS[@]}" "$TARGET" \
  "curl -sS -o /tmp/me.json -w '%{http_code}' http://127.0.0.1:8787/bff/me")
body=$(ssh "${SSH_OPTS[@]}" "$TARGET" "cat /tmp/me.json")
[ "$code" = "401" ] || fail "/bff/me returned $code, expected 401"
grep -q SESSION_EXPIRED <<<"$body" || fail "/bff/me missing SESSION_EXPIRED code: $body"

# The UI must actually be served, not just the API.
ssh "${SSH_OPTS[@]}" "$TARGET" \
  "curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/" | grep -q 200 \
  || fail "UI root did not return 200"

# The Node process must NOT be reachable from outside; nginx fronts it.
listening=$(ssh "${SSH_OPTS[@]}" "$TARGET" "ss -ltnp | grep ':8787' || true")
grep -q '127.0.0.1:8787' <<<"$listening" \
  || fail "8787 is not bound to loopback — it may be internet-facing: $listening"

printf '\n\033[32mDeployed and verified.\033[0m\n'
printf '  /bff/me      401 SESSION_EXPIRED\n  /            200\n  8787         loopback only\n'
