#!/usr/bin/env bash
# Exercises live-guard.sh against a scratch repository with two diverged
# branches, the shape two agents deploying from two worktrees actually make.
# It checks the refusal, not only the pass: a guard that never says no looks
# exactly like one that works.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: expected '$3', got '$2'"; fail=1; fi; }

. "$HERE/live-guard.sh"

cd "$WORK"
git init -q -b main .
git config user.email guard@test.invalid
git config user.name guard
commit() { echo "$1" > "$1.txt"; git add "$1.txt"; git commit -q -m "$1"; git rev-parse HEAD; }

base=$(commit base)
git checkout -q -b theirs
theirs=$(commit their-fix)
git checkout -q main
mine=$(commit my-fix)

# 1. HEAD contains what is live: ships.
contains_live "$base" 0 >/dev/null 2>&1
check "ships when HEAD contains the live commit" "$?" "0"

# 2. Redeploying the commit that is live: ships.
contains_live "$mine" 0 >/dev/null 2>&1
check "ships when the live commit is HEAD" "$?" "0"

# 3. The other worktree's fix is live and not here: refuses, and names both.
out=$(contains_live "$theirs" 0 2>&1)
check "refuses when HEAD lacks the live commit" "$?" "1"
check "the refusal names HEAD" "$(grep -c "$mine" <<<"$out")" "1"
check "the refusal names the live commit" "$(grep -c "$theirs" <<<"$out")" "1"
check "the refusal lists what would be undone" "$(grep -c "their-fix" <<<"$out")" "1"

# 4. Once merged, the same deploy ships.
git merge -q --no-edit theirs
contains_live "$theirs" 0 >/dev/null 2>&1
check "ships after merging what is live" "$?" "0"

# 5. A live commit this checkout has never seen: refuses rather than guessing.
contains_live "0123456789abcdef0123456789abcdef01234567" 0 >/dev/null 2>&1
check "refuses a live commit it cannot see" "$?" "1"

# 6. --rollback is the deliberate way through, for both refusals.
git checkout -q "$mine"
contains_live "$theirs" 1 >/dev/null 2>&1
check "--rollback ships a tree that lacks the live commit" "$?" "0"
contains_live "0123456789abcdef0123456789abcdef01234567" 1 >/dev/null 2>&1
check "--rollback ships over an unknown live commit" "$?" "0"

# 7. A box with nothing recorded cannot say what is running, so it is refused
#    like an unknown commit. A brand-new box goes through with --rollback.
out=$(contains_live "" 0 2>&1)
check "refuses when the box records no deployed commit" "$?" "1"
check "the refusal says what to do on a new box" "$(grep -c -- "--rollback" <<<"$out")" "1"
contains_live "" 1 >/dev/null 2>&1
check "--rollback ships to a box with no deployed commit" "$?" "0"

exit "$fail"
