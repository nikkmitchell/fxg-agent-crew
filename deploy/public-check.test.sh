#!/usr/bin/env bash
# Exercises public-check.sh against a stub curl, because the thing worth
# asserting is what it does when the NETWORK fails rather than the site.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: expected '$3', got '$2'"; fail=1; fi; }

# A curl that fails the first N times, then answers $STUB_CODE, counting calls.
cat > "$WORK/curl" <<'STUB'
#!/bin/sh
count=$(cat "$STUB_COUNT" 2>/dev/null || echo 0)
count=$((count + 1))
echo "$count" > "$STUB_COUNT"
# LIKE THE REAL CURL: on failure it still writes %{http_code}, which is 000,
# and then exits non-zero. A stub that printed nothing let "000000" through.
if [ "$count" -le "${STUB_FAIL_TIMES:-0}" ]; then printf '000'; exit 7; fi
for arg in "$@"; do
  case "$prev" in -o) out="$arg" ;; esac
  prev="$arg"
done
[ -n "${STUB_BODY:-}" ] && [ -n "${out:-}" ] && printf '%s' "$STUB_BODY" > "$out"
printf '%s' "${STUB_CODE:-200}"
STUB
chmod +x "$WORK/curl"
export PATH="$WORK:$PATH" STUB_COUNT="$WORK/count" PUBLIC_CHECK_PAUSE=0
. "$HERE/public-check.sh"

# 1. A site that answers first time: one call, no retries.
: > "$STUB_COUNT"; export STUB_FAIL_TIMES=0 STUB_CODE=200 STUB_BODY=""
check "returns the status" "$(public_code https://example.test/)" "200"
check "asks once when it answers" "$(cat "$STUB_COUNT")" "1"

# 2. A real status is an answer, not a flake: 404 comes back immediately.
: > "$STUB_COUNT"; export STUB_CODE=404
check "returns 404 without retrying" "$(public_code https://example.test/)" "404"
check "asked once for the 404" "$(cat "$STUB_COUNT")" "1"

# 3. A network that drops twice and then works: the deploy is not failed by it.
: > "$STUB_COUNT"; export STUB_FAIL_TIMES=2 STUB_CODE=200
check "survives two dropped connections" "$(public_code https://example.test/)" "200"
check "asked three times" "$(cat "$STUB_COUNT")" "3"

# 4. Nothing at all, three times: 000, which the caller must report as "could
#    not reach" rather than as a fact about the site.
: > "$STUB_COUNT"; export STUB_FAIL_TIMES=99 STUB_CODE=200
check "gives up with 000" "$(public_code https://example.test/)" "000"
check "tried three times before giving up" "$(cat "$STUB_COUNT")" "3"

# 5. The body is written where the caller asked, for the robots.txt check.
: > "$STUB_COUNT"; export STUB_FAIL_TIMES=0 STUB_CODE=200 STUB_BODY="User-agent: *
Disallow: /"
public_code https://example.test/robots.txt "$WORK/body" >/dev/null
check "writes the body to the file given" "$(grep -c Disallow "$WORK/body")" "1"

exit "$fail"
