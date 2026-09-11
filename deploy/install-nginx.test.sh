#!/usr/bin/env bash
# Exercises install-nginx.sh against a scratch destination and a stub `nginx`.
# The point is the rollback: on 2026-09-08 a bad config reached disk and stayed
# there. This asserts that a config failing `nginx -t` never survives.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: expected '$3', got '$2'"; fail=1; fi; }

cat > "$WORK/nginx" <<'STUB'
#!/bin/sh
grep -q DELIBERATELY_INVALID "$FXG_NGINX_SITE" 2>/dev/null && { echo "test failed" >&2; exit 1; }
exit 0
STUB
chmod +x "$WORK/nginx"
export FXG_NGINX_BIN="$WORK/nginx" FXG_NGINX_SITE="$WORK/fxg-crew" FXG_CERT_DIR="$WORK/certs"

# 1. installs, and substitutes every placeholder
"$HERE/install-nginx.sh" example.test >/dev/null 2>&1
check "installs a good config" "$?" "0"
check "no placeholder survives" "$(grep -c SERVER_NAME_HERE "$FXG_NGINX_SITE" || true)" "0"
check "server_name substituted" "$(grep -c 'server_name example.test;' "$FXG_NGINX_SITE")" "2"

# 2. a config that fails `nginx -t` must not survive, and the previous one must
#    come back byte for byte.
GOOD="$(cat "$FXG_NGINX_SITE")"
cp "$HERE/nginx.conf" "$WORK/broken.conf"; echo "DELIBERATELY_INVALID" >> "$WORK/broken.conf"
cp "$HERE/install-nginx.sh" "$WORK/install-nginx.sh"; cp "$WORK/broken.conf" "$WORK/nginx.conf"
"$WORK/install-nginx.sh" example.test >/dev/null 2>&1
check "refuses a config nginx rejects" "$?" "1"
check "bad config did not reach disk" "$(grep -c DELIBERATELY_INVALID "$FXG_NGINX_SITE" || true)" "0"
check "previous config restored intact" "$(cat "$FXG_NGINX_SITE")" "$GOOD"

# 3. first-ever install that fails leaves no file behind at all
rm -f "$FXG_NGINX_SITE"
"$WORK/install-nginx.sh" example.test >/dev/null 2>&1
check "failed first install leaves no file" "$([ -e "$FXG_NGINX_SITE" ] && echo present || echo absent)" "absent"

# Test 3 deliberately leaves no file behind, so put a good one back before
# inspecting its contents. Reading an absent file would make every check below
# fail for the wrong reason — or worse, pass vacuously if one were written
# loosely.
cp "$HERE/nginx.conf" "$WORK/nginx.conf"
"$HERE/install-nginx.sh" example.test >/dev/null 2>&1

# 4. The two things that were WRONG in production, asserted so they cannot come
#    back quietly. Both were invisible: one refused uploads the app would have
#    accepted, the other would have made every WebSocket handshake return HTML.
check "passes WebSocket upgrade through" \
  "$(grep -cF 'proxy_set_header Upgrade           $http_upgrade' "$FXG_NGINX_SITE")" "1"
check "sends Connection: upgrade only when asked" \
  "$(grep -cF 'map $http_upgrade $connection_upgrade' "$FXG_NGINX_SITE")" "1"

# The body limit must sit ABOVE the application's own, so the app stays the
# thing that refuses and explains. Read from the source rather than restated
# here, because a number copied into a test is a number that drifts.
APP_MB=$(grep -o 'MAX_BYTES = [0-9]* \* 1024 \* 1024' "$HERE/../server/db/blobs.ts" | grep -o '^MAX_BYTES = [0-9]*' | grep -o '[0-9]*')
NGINX_MB=$(grep -o 'client_max_body_size [0-9]*m' "$FXG_NGINX_SITE" | grep -o '[0-9]*')
if [ -n "$APP_MB" ] && [ -n "$NGINX_MB" ] && [ "$NGINX_MB" -gt "$APP_MB" ]; then
  echo "ok   - nginx body limit (${NGINX_MB}m) is above the app's (${APP_MB}m)"
else
  echo "FAIL - nginx body limit ${NGINX_MB}m must exceed the app's ${APP_MB}m, or nginx refuses uploads the app would accept — in nginx's words, not ours"
  fail=1
fi

# 5. Framing is allowed for US and nobody else.
#
# The room shows the real tabs as same-origin iframes, so DENY breaks it. The
# failure mode of getting this wrong in the other direction is far worse and
# completely silent: a permissive value hands every other site the ability to
# frame saha.ing and trick a signed-in person into clicking things. So both the
# presence of the restriction AND its exact value are asserted.
check "refuses framing by other sites" \
  "$(grep -cF 'add_header X-Frame-Options "SAMEORIGIN" always;' "$FXG_NGINX_SITE")" "1"
check "no ALLOWALL or wildcard framing" \
  "$(grep -ciE 'X-Frame-Options "(ALLOWALL|ALLOW-FROM)' "$FXG_NGINX_SITE" || true)" "0"
check "frame-ancestors is self only" \
  "$(grep -cF "frame-ancestors 'self'" "$FXG_NGINX_SITE")" "1"
check "frame-ancestors has no wildcard" \
  "$(grep -cE "frame-ancestors[^\"]*\*" "$FXG_NGINX_SITE" || true)" "0"

[ "$fail" = 0 ] && echo "all deploy/install-nginx.sh checks passed"
exit "$fail"
