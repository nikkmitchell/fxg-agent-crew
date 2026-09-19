#!/usr/bin/env bash
# Asking the public URL a question, from a machine whose network is not the site.
#
# The verification at the end of release.sh runs from wherever you deployed
# from, and that machine's connection is not evidence about saha.ing. This
# laptop's HTTPS proxy comes and goes; twice in one night a deploy that had
# already shipped, restarted and passed every check ON THE BOX was reported
# FAILED because a curl here timed out — and one of those failures said
# "/robots.txt is served but contains no Disallow directive", which is an
# assertion about the site derived from an empty response.
#
#   public_code <url> [body-file]   -> an HTTP status, or 000 for no answer
#
# 000 means nothing came back after three tries and the caller must say so
# rather than say something about the site. A real status is returned at once:
# a 404 is an answer, not a flake, and retrying it only hides it.
#
# Tested by deploy/public-check.test.sh against a stub curl.

public_code() {
  local url="$1" body="${2:-/dev/null}" code=""
  for attempt in 1 2 3; do
    code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 "$url" 2>/dev/null || echo "000")
    [ "$code" != "000" ] && break
    # A moment for a flapping proxy to come back. Zero in tests, which assert
    # the retry COUNT: a suite that waits six seconds to prove nothing is a
    # suite people stop running, and this one runs before every deploy.
    [ "$attempt" != "3" ] && sleep "${PUBLIC_CHECK_PAUSE:-2}"
  done
  printf '%s' "$code"
}
