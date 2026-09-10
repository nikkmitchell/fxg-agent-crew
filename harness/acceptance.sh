#!/usr/bin/env bash
#
# Bring up the acceptance stack: the REAL BFF and the REAL built UI, against a
# fake upstream that can be broken on command.
#
# The BFF is not stubbed. Sessions, cursors, the send path and the
# 2000-character refusal all live there, and a harness that replaced it would
# prove nothing about what we ship. Only the thing we cannot break on demand —
# the upstream server — is replaced.
#
#   harness/acceptance.sh          start (rebuilds the UI first)
#   harness/acceptance.sh stop
#
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

FAKE_PORT=${FAKE_PORT:-8899}
BFF_PORT=${BFF_PORT:-8788}
RUN=.harness-run
mkdir -p "$RUN"

# Anything still listening on our ports, but ONLY if it is one of ours.
#
# The first version of this script trusted its pid files, so a leftover process
# from an earlier run kept port 8899 while the new fake died with EADDRINUSE —
# and the readiness probe passed, because something WAS answering. The script
# printed "ready" and the browser then tested yesterday's data. That is the
# house failure: a check that confirms a process is answering, not that the
# right process is.
release_port() {
  local port="$1" pattern="$2" pid command
  for pid in $(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true); do
    command=$(ps -o command= -p "$pid" 2>/dev/null || true)
    case "$command" in
      *"$pattern"*) kill "$pid" 2>/dev/null || true ;;
      *)
        echo "port $port is held by a process that is not ours:" >&2
        echo "  pid $pid: $command" >&2
        echo "refusing to kill it. Free the port, or set FAKE_PORT/BFF_PORT." >&2
        exit 1
        ;;
    esac
  done
}

stop() {
  for name in fake bff; do
    if [ -f "$RUN/$name.pid" ]; then
      kill "$(cat "$RUN/$name.pid")" 2>/dev/null || true
      rm -f "$RUN/$name.pid"
    fi
  done
  release_port "$FAKE_PORT" "harness/fake-webharness"
  release_port "$BFF_PORT" "server/index.ts"
  # Ports do not free instantly, and the next bind failing is the whole bug.
  for _ in $(seq 1 25); do
    lsof -tiTCP:"$FAKE_PORT" -sTCP:LISTEN >/dev/null 2>&1 || break
    sleep 0.2
  done
  echo "stopped"
}
[ "${1:-start}" = "stop" ] && { stop; exit 0; }

stop
# Built, not dev-served: the dev server resolves modules differently and this is
# meant to exercise the artifact that gets deployed.
pnpm run build >"$RUN/build.log" 2>&1 || { tail -20 "$RUN/build.log"; echo "build failed"; exit 1; }

FAKE_PORT=$FAKE_PORT FAKE_SEED=${FAKE_SEED:-120} \
  ./node_modules/.bin/tsx harness/fake-webharness.ts >"$RUN/fake.log" 2>&1 &
echo $! > "$RUN/fake.pid"

# Wait for readiness rather than sleeping: a fixed sleep is a race that passes
# on this laptop and fails on a slower one.
# Ready means OUR process is answering. Checking only that something answers is
# how the previous version passed against a stale server.
for _ in $(seq 1 50); do
  kill -0 "$(cat "$RUN/fake.pid")" 2>/dev/null || { tail -20 "$RUN/fake.log"; echo "fake upstream died on startup"; exit 1; }
  curl -sf "http://127.0.0.1:$FAKE_PORT/__control/state" >/dev/null && break
  sleep 0.2
done
kill -0 "$(cat "$RUN/fake.pid")" 2>/dev/null || { tail -20 "$RUN/fake.log"; exit 1; }

FAKE_URL="http://127.0.0.1:$FAKE_PORT" ./node_modules/.bin/tsx harness/seed.ts

WEBHARNESS_URL="http://127.0.0.1:$FAKE_PORT" PORT=$BFF_PORT PROJECT_MUTATORS=tester \
  SESSION_SECRET=harness-only \
  ./node_modules/.bin/tsx server/index.ts >"$RUN/bff.log" 2>&1 &
echo $! > "$RUN/bff.pid"

for _ in $(seq 1 50); do
  kill -0 "$(cat "$RUN/bff.pid")" 2>/dev/null || { tail -20 "$RUN/bff.log"; echo "BFF died on startup"; exit 1; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$BFF_PORT/bff/me")" = "401" ] && break
  sleep 0.2
done

# Prove the board the browser is about to be tested against is the one we just
# seeded, and that nothing was refused on the way in. A silent rejection here
# means the browser tests an empty board and passes for the wrong reason.
COOKIE=$(curl -s -i -X POST "http://127.0.0.1:$BFF_PORT/bff/login" \
  -H 'content-type: application/json' -d '{"username":"tester","password":"tester"}' |
  grep -o 'fxg_sid=[^;]*')
SUMMARY=$(curl -s "http://127.0.0.1:$BFF_PORT/bff/projects?room=AgentParty" -H "Cookie: $COOKIE")
python3 - "$SUMMARY" <<'CHECK'
import json, sys
board = json.loads(sys.argv[1])
rejected = board.get("rejected") or []
if rejected:
    print("seeded events were REFUSED — the browser would test the wrong board:", file=sys.stderr)
    for row in rejected[:5]:
        print(f"  {row}", file=sys.stderr)
    raise SystemExit(1)
tasks = board.get("tasks") or []
if not board.get("projects") or not tasks:
    print("board came back empty after seeding", file=sys.stderr)
    raise SystemExit(1)
print(f"  seeded board: {len(board['projects'])} project(s), {len(tasks)} card(s), "
      f"{sum(len(t.get('comments') or []) for t in tasks)} comment(s), 0 refused")
CHECK

cat <<INFO

  UI + BFF   http://127.0.0.1:$BFF_PORT      sign in as tester / tester
  fake       http://127.0.0.1:$FAKE_PORT     POST /__control/{fail-sends,offline,say,reset}
  logs       $RUN/

INFO
