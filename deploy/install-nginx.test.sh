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

[ "$fail" = 0 ] && echo "all deploy/install-nginx.sh checks passed"
exit "$fail"
