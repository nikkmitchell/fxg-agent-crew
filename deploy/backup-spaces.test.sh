#!/usr/bin/env bash
# Exercises backup.sh's space repositories (Sill, 6468): every repo with a
# branch becomes a bundle, an empty repo is skipped, --verify checks each
# bundle, and a bundle restores into a clone with every branch and commit.
# It checks the whole round trip, not only that a file appeared.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "ok   - $1"; else echo "FAIL - $1: expected '$3', got '$2'"; fail=1; fi; }

# A tiny saha.ing: a database with the tables --verify reads, no blobs.
mkdir -p "$WORK/blobs" "$WORK/spaces/repos"
sqlite3 "$WORK/saha.db" "CREATE TABLE projects(id); CREATE TABLE tasks(id); CREATE TABLE comments(id); CREATE TABLE blobs(sha256, mime);"

# A space with two branches, and one with none yet.
git init -q --bare --initial-branch=main "$WORK/spaces/repos/xr.instruments.git"   # as server/spaces/git.ts makes them
git init -q --bare --initial-branch=main "$WORK/spaces/repos/empty.space.git"
src="$WORK/src"; git init -q -b main "$src"
git -C "$src" config user.email t@test.invalid; git -C "$src" config user.name test
echo marimba > "$src/index.html"; git -C "$src" add -A; git -C "$src" commit -qm "the marimba"
git -C "$src" checkout -qb drums; echo drums > "$src/drums.js"; git -C "$src" add -A; git -C "$src" commit -qm "hand drums"
git -C "$src" push -q "$WORK/spaces/repos/xr.instruments.git" main drums

out=$(DATABASE_PATH="$WORK/saha.db" BLOB_ROOT="$WORK/blobs" BACKUP_ROOT="$WORK/backups" SPACES_ROOT="$WORK/spaces" \
  bash "$HERE/backup.sh" --verify 2>&1); status=$?
check "backup.sh --verify succeeds" "$status" "0"
check "says how many repos it bundled" "$(echo "$out" | grep -c 'bundled 1 space repo')" "1"
check "says every bundle verifies" "$(echo "$out" | grep -c 'every space bundle verifies')" "1"

stamp=$(ls "$WORK/backups/spaces" | head -1)
check "bundles the repo with branches" "$(ls "$WORK/backups/spaces/$stamp")" "xr.instruments.bundle"

# The restore the docs describe: clone straight from the bundle.
git clone -q "$WORK/backups/spaces/$stamp/xr.instruments.bundle" "$WORK/restored" 2>/dev/null
check "restores main" "$(cat "$WORK/restored/index.html")" "marimba"
check "restores every branch" "$(git -C "$WORK/restored" branch -r | grep -c 'origin/drums')" "1"
check "restores the history" "$(git -C "$WORK/restored" log --format=%s origin/drums | tr '\n' ',')" "hand drums,the marimba,"

# The server's restore (docs/SPACES.md): a mirror clone IS the bare repo to put back.
git clone -q --mirror "$WORK/backups/spaces/$stamp/xr.instruments.bundle" "$WORK/put-back.git" 2>/dev/null
check "a mirror clone has every branch" "$(git --git-dir="$WORK/put-back.git" for-each-ref --format='%(refname)' refs/heads | tr '\n' ',')" "refs/heads/drums,refs/heads/main,"

# A broken bundle is caught by --verify.
echo garbage > "$WORK/backups/spaces/$stamp/xr.instruments.bundle"
git init -q "$WORK/verifier"
if git -C "$WORK/verifier" bundle verify -q "$WORK/backups/spaces/$stamp/xr.instruments.bundle" >/dev/null 2>&1; then verdict=passed; else verdict=refused; fi
check "a damaged bundle does not verify" "$verdict" "refused"

# One repo that will not bundle is named, the others are still bundled, and the run fails.
cp -R "$WORK/spaces/repos/xr.instruments.git" "$WORK/spaces/repos/broken.space.git"
blob=$(git --git-dir="$WORK/spaces/repos/broken.space.git" rev-parse drums:drums.js)
rm -f "$WORK/spaces/repos/broken.space.git/objects/${blob:0:2}/${blob:2}"
sleep 1  # a new stamp, a second apart
out=$(DATABASE_PATH="$WORK/saha.db" BLOB_ROOT="$WORK/blobs" BACKUP_ROOT="$WORK/backups" SPACES_ROOT="$WORK/spaces" \
  bash "$HERE/backup.sh" 2>&1); status=$?
check "a repo that will not bundle fails the run" "$status" "1"
check "and is named" "$(echo "$out" | grep -c 'could not bundle the space broken.space')" "1"
latest=$(ls -t "$WORK/backups/spaces" | head -1)
check "the others are still bundled" "$(ls "$WORK/backups/spaces/$latest")" "xr.instruments.bundle"
check "the database copy is still made" "$(ls "$WORK/backups/db" | wc -l | tr -d ' ')" "2"

exit $fail
